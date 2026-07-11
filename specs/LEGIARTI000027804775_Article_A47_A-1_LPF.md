# Article A47 A-1 du Livre des procédures fiscales (LPF)

**Source**: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000027804775
**Fetched**: 2026-07-11, via WebFetch (content below is the tool's extraction/
transcription of the Légifrance page, not a raw HTML/PDF capture — treat as
a strong secondary confirmation of the primary text, not a substitute for
reading the live article directly if a future dispute turns on exact wording).

This is the article referenced throughout `CLAUDE.md` "FEC export" and is
the actual legal source for the FEC (Fichier des Écritures Comptables)
format — the BOI-CF-IOR-60-40-20 document also in `specs/` is DGFiP
*commentary* on this article, not the article itself.

## Section VI — Accepted file formats

- Flat files ("fichiers à plat") with tabulation or `|` as the field
  separator.
- XML-structured files following the published XSD specification.

## Section VII — Standard accounting: 18 mandatory fields, in this order

```
JournalCode | JournalLib | EcritureNum | EcritureDate | CompteNum |
CompteLib | CompAuxNum | CompAuxLib | PieceRef | PieceDate | EcritureLib |
Debit | Credit | EcritureLet | DateLet | ValidDate | Montantdevise | Idevise
```

Alternative: fields 12–13 (Debit/Credit) may be replaced by `Montant` and
`Sens` (signed amount + D/C or +1/-1 indicator) — see BOI-CF-IOR-60-40-20
§220-230 for the worked examples of this alternate scheme.

## Section VIII — Simplified accounting (agricultural / non-commercial income)

18–22 required fields depending on record type (not detailed further in
this extraction — re-fetch/verify directly if this project ever needs to
support micro-BIC/micro-BNC recordkeeping).

## Section XII — Codage des informations (format specification)

- **Character sets**: ASCII, ISO 8859-15, or UTF-8.
- **Numeric values**: decimal base, right-aligned, **comma as the decimal
  separator**, no thousands separator.
- **Alphanumeric values**: left-aligned, right-padded with spaces.
- **Dates**: `AAAAMMJJ` format, no separators.

## File naming

`{SIREN}FEC{AAAAMMJJ}` where SIREN is the company's SIREN and `AAAAMMJJ`
is the fiscal year's closing date — confirms `fecFileName()` in
`backend/src/modules/fec/fec-format.ts`.

## Cross-check against this codebase (2026-07-11 re-audit)

| Claim previously flagged as unverified/wrong | This article says | Code status |
|---|---|---|
| Decimal separator | **Comma**, confirmed | Fixed — `Money.toFecString()`, used in `formatFecAmount` |
| Column order | Exactly `JournalCode, JournalLib, EcritureNum, EcritureDate, CompteNum, CompteLib, CompAuxNum, CompAuxLib, PieceRef, PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate, Montantdevise, Idevise` | Matches `FEC_COLUMNS` exactly, now pinned by `fec-format.spec.ts` |
| AAAAMMJJ dates | Confirmed, no separators | Matches `formatFecDate` |
| File naming | `{SIREN}FEC{AAAAMMJJ}` | Matches `fecFileName` for FR; the RCI-based Monaco variant is this project's own extension, not something this article covers — still flagged under "Monaco compliance" in CLAUDE.md |

No divergences remain against this primary text for the four items fixed.
Section VIII (simplified/micro-BIC accounting field counts) is not yet
cross-checked against the codebase since nothing in this project currently
targets that regime.
