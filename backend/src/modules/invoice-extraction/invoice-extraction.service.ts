import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PDFParse } from 'pdf-parse';
import { cellValueToString } from '../import-excel/import-excel.service';

/** A field the DETERMINISTIC parser found — never model-guessed. */
export interface ExtractedInvoiceField {
  value: string;
  source: 'parsed';
}

export interface ExtractedInvoiceFacts {
  fileName: string;
  fields: {
    montantTtc?: ExtractedInvoiceField;
    montantHt?: ExtractedInvoiceField;
    montantTva?: ExtractedInvoiceField;
    numeroFacture?: ExtractedInvoiceField;
    dateFacture?: ExtractedInvoiceField;
  };
  /** Capped raw text — the model's only source for anything the parser above didn't find (e.g. supplier name), and it must be told to flag those as its own reading, never a parsed fact. */
  rawText: string;
}

const MAX_RAW_TEXT_LENGTH = 6000;

/**
 * DETERMINISTIC EXTRACTION FIRST, MODEL JUDGMENT SECOND — see CLAUDE.md
 * "AI chatbot Phase 2 — invoice extraction". This service never guesses:
 * a field is either found by an anchored label/regex match (tagged
 * `source: "parsed"`) or simply ABSENT from `fields`. It never invents a
 * number. The model consuming this output is instructed (see
 * chat-orchestrator.service.ts's system prompt) to treat parsed fields
 * as fact and to explicitly flag anything it reads from `rawText` itself
 * as its own, lower-confidence reading — this service has no opinion on
 * accounting classification (charge vs. immobilisation, which account,
 * VAT treatment) at all, only on what the document's own text says.
 *
 * Reuses this app's existing file-parsing building blocks rather than
 * reinventing extraction: `exceljs` (already a dependency, the same
 * library import-excel.service.ts already uses, including its own
 * `cellValueToString()` rich-cell-value helper) for Excel, and a new
 * `pdf-parse` dependency (a plain, dependency-light Node text extractor
 * — this app had no PDF-parsing capability inside the deployed backend
 * before this) for PDF.
 */
@Injectable()
export class InvoiceExtractionService {
  async extract(file: Express.Multer.File): Promise<ExtractedInvoiceFacts> {
    const rawText = await this.extractRawText(file);
    return {
      fileName: file.originalname,
      fields: extractFieldsFromText(rawText),
      rawText: rawText.slice(0, MAX_RAW_TEXT_LENGTH),
    };
  }

  private async extractRawText(file: Express.Multer.File): Promise<string> {
    const extension = (file.originalname.split('.').pop() ?? '').toLowerCase();
    if (extension === 'pdf' || file.mimetype === 'application/pdf') {
      return this.extractPdfText(file.buffer);
    }
    if (
      extension === 'xlsx' ||
      extension === 'xls' ||
      file.mimetype.includes('spreadsheet') ||
      file.mimetype.includes('excel')
    ) {
      return this.extractExcelText(file.buffer);
    }
    throw new BadRequestException(
      `Type de fichier non pris en charge pour "${file.originalname}" — seuls le PDF et l'Excel (.xlsx/.xls) sont acceptés pour une facture.`,
    );
  }

  private async extractPdfText(buffer: Buffer): Promise<string> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText({ pageJoiner: '' });
      return result.text;
    } finally {
      await parser.destroy();
    }
  }

  private async extractExcelText(buffer: Buffer): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    const lines: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        const cells: string[] = [];
        row.eachCell({ includeEmpty: false }, (cell) => {
          const text = cellValueToString(cell.value).trim();
          if (text) cells.push(text);
        });
        if (cells.length > 0) lines.push(cells.join(' | '));
      });
    });
    return lines.join('\n');
  }
}

// Anchored on a French invoice's own common labels — deliberately narrow
// (a miss just leaves the field absent, never a wrong guess). Applied
// case-insensitively; `[\s\S]{0,20}` between the label and the number
// tolerates a colon, a currency symbol, or a couple of stray words
// without ever crossing into the NEXT line's own label.
const FIELD_PATTERNS: {
  key: keyof ExtractedInvoiceFacts['fields'];
  pattern: RegExp;
}[] = [
  {
    key: 'montantTtc',
    pattern: /montant\s*ttc[\s\S]{0,20}?([0-9][0-9\s]*[.,]\d{2})/i,
  },
  {
    key: 'montantHt',
    pattern: /montant\s*ht[\s\S]{0,20}?([0-9][0-9\s]*[.,]\d{2})/i,
  },
  {
    key: 'montantTva',
    pattern:
      /(?:montant\s*)?tva(?:\s*\d{1,2}(?:[.,]\d+)?\s*%)?[\s\S]{0,20}?([0-9][0-9\s]*[.,]\d{2})/i,
  },
  {
    key: 'numeroFacture',
    pattern: /(?:facture|invoice)\s*n[°:o]?[\s\S]{0,10}?([a-z0-9][a-z0-9\-/]{2,})/i,
  },
  {
    key: 'dateFacture',
    pattern: /date(?:\s+de\s+facture)?[\s\S]{0,10}?(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/i,
  },
];

export function extractFieldsFromText(text: string): ExtractedInvoiceFacts['fields'] {
  const fields: ExtractedInvoiceFacts['fields'] = {};
  for (const { key, pattern } of FIELD_PATTERNS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const raw = match[1];
    const value = key.startsWith('montant') ? normalizeParsedAmount(raw) : raw.trim();
    if (value) {
      fields[key] = { value, source: 'parsed' };
    }
  }
  return fields;
}

/** "1 200,00" / "1200.00" / "1 200.00" → "1200.00". Never throws — an unparsable amount is simply not returned as a field. */
function normalizeParsedAmount(raw: string): string | undefined {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  return /^\d+\.\d{2}$/.test(normalized) ? normalized : undefined;
}
