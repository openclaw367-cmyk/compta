import { parseDelimitedText } from './delimited-text-parser';

describe('parseDelimitedText', () => {
  it('splits a simple delimited file into rows/fields', () => {
    const text = 'a,b,c\n1,2,3\n';
    expect(parseDelimitedText(text, ',')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('supports a non-comma delimiter (pipe, per FEC)', () => {
    const text = 'JournalCode|EcritureNum\nAC|1\n';
    expect(parseDelimitedText(text, '|')).toEqual([
      ['JournalCode', 'EcritureNum'],
      ['AC', '1'],
    ]);
  });

  it('handles CRLF line endings', () => {
    const text = 'a,b\r\n1,2\r\n';
    expect(parseDelimitedText(text, ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a quoted field containing the delimiter', () => {
    const text = 'label,amount\n"Achat, fournitures",100\n';
    expect(parseDelimitedText(text, ',')).toEqual([
      ['label', 'amount'],
      ['Achat, fournitures', '100'],
    ]);
  });

  it('handles a quoted field containing a literal newline', () => {
    const text = 'label,amount\n"Line one\nLine two",50\n';
    expect(parseDelimitedText(text, ',')).toEqual([
      ['label', 'amount'],
      ['Line one\nLine two', '50'],
    ]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    const text = 'label\n"Say ""hi"" now"\n';
    expect(parseDelimitedText(text, ',')).toEqual([['label'], ['Say "hi" now']]);
  });

  it('drops a wholly blank trailing row from a trailing newline', () => {
    const text = 'a,b\n1,2\n\n';
    expect(parseDelimitedText(text, ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('handles a file with no trailing newline', () => {
    const text = 'a,b\n1,2';
    expect(parseDelimitedText(text, ',')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseDelimitedText('', ',')).toEqual([]);
  });
});
