import { ConflictException, Injectable } from '@nestjs/common';
import { CompanyContext } from '../../common/tenant/company-context';
import { importEsm } from '../../common/esm-interop';
import { registerWindowsXsdImportFix } from '../../common/libxml2-windows-path-fix';
import { InvoicingService } from './invoicing.service';
import { buildCrossIndustryInvoice } from './invoice-to-cii';
import { renderInvoicePdf } from './factur-x-pdf';

const FLAVOR = 'facturx';
const LEVEL = 'en16931';

// @stafyniaksacha/facturx is ESM-only — see invoice-to-cii.ts's own doc comment
// (and common/esm-interop.ts) for why every runtime use goes through a cached,
// un-downleveled dynamic import(), never a static import of a value from it.
let cachedFacturX: typeof import('@stafyniaksacha/facturx') | null = null;
async function loadFacturX(): Promise<typeof import('@stafyniaksacha/facturx')> {
  if (!cachedFacturX) {
    cachedFacturX =
      await importEsm<typeof import('@stafyniaksacha/facturx')>('@stafyniaksacha/facturx');
  }
  return cachedFacturX;
}

/**
 * Renders a FINALIZED invoice to a real Factur-X 1.09 / EN16931 file —
 * PDF/A-3 with the CII XML embedded — and verifies it against the
 * official XSD + Schematron EN16931 business rules before returning it.
 * See specs/invoicing-factur-x-implementation-spec.md.
 *
 * Reuses InvoicingService.getMentions() verbatim for the source data —
 * the SAME mentions object already tied to the actual posted écriture
 * (see invoicing.service.ts's own doc comment on that tie-out). This
 * module adds no new business computation, only rendering + validation.
 */
@Injectable()
export class FacturXService {
  constructor(private readonly invoicingService: InvoicingService) {}

  async render(company: CompanyContext, invoiceId: string): Promise<Uint8Array> {
    const mentions = await this.invoicingService.getMentions(company, invoiceId);
    const { check, extract, generate, invoiceToXml } = await loadFacturX();
    // Must run AFTER loadFacturX() (which imports 'libxml2-wasm/lib/nodejs.mjs' as a
    // side effect, registering the buggy default provider) so this fix's own
    // provider registers second and is tried first — see the fix's own doc comment.
    await registerWindowsXsdImportFix();

    const cii = await buildCrossIndustryInvoice(mentions);
    const xmlDoc = await invoiceToXml(cii);
    const xml = xmlDoc.toString();

    // Validate the constructed XML BEFORE embedding — never hand back a file that
    // wouldn't itself pass the official schema/business-rule check.
    const preEmbedCheck = await check({ xml, flavor: FLAVOR, level: LEVEL, schematron: true });
    if (!preEmbedCheck.valid || preEmbedCheck.schematronValid === false) {
      throw new ConflictException(
        `Generated Factur-X XML failed validation before embedding: ` +
          `${JSON.stringify({ errors: preEmbedCheck.errors, schematronErrors: preEmbedCheck.schematronErrors })}`,
      );
    }

    const humanReadablePdf = await renderInvoicePdf(mentions);
    const facturXPdf = await generate({
      pdf: Buffer.from(humanReadablePdf),
      xml,
      flavor: FLAVOR,
      level: LEVEL,
      meta: {
        author: mentions.seller.name,
        title: `${mentions.isCreditNote ? 'Avoir' : 'Facture'} ${mentions.invoiceNumber}`,
        subject: `${mentions.isCreditNote ? 'Avoir' : 'Facture'} ${mentions.invoiceNumber} — ${mentions.buyer.name}`,
        keywords: ['factur-x', FLAVOR, LEVEL],
        date: new Date(mentions.invoiceDate),
      },
    });

    // The round-trip check — extract the XML back OUT of the generated PDF/A-3 and
    // re-validate THAT copy, proving the embedding step didn't corrupt anything, not
    // just that the pre-embed XML was valid. See the implementation spec's own
    // "verified two ways" discipline.
    const extracted = await extract({ pdf: Buffer.from(facturXPdf), check: false });
    const postEmbedCheck = await check({
      xml: extracted.xml,
      flavor: FLAVOR,
      level: LEVEL,
      schematron: true,
    });
    if (!postEmbedCheck.valid || postEmbedCheck.schematronValid === false) {
      throw new ConflictException(
        `Factur-X file failed validation AFTER embedding (round-trip check): ` +
          `${JSON.stringify({ errors: postEmbedCheck.errors, schematronErrors: postEmbedCheck.schematronErrors })}`,
      );
    }

    return facturXPdf;
  }
}
