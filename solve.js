// A fast drop-in for csv-reader 1.0.0: run(input) returns exactly the answer csv-reader returns for {text, header},
// the JSON value {columns, rows, errors}, but reads the text with slice-based scanning instead of one character at a
// time. The broken-row policy is csv-reader's own, followed point for point:
//
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no record;
//   - outside quotes a CR not followed by LF is dropped (stray_cr);
//   - a field that opens with a quote runs to the next quote that is not doubled ("" inside it is one quote, and each
//     CRLF or lone CR inside it is read as LF); what follows its closing quote, up to the next comma or line break, is
//     appended as it stands (quote_junk, when the field ends); a quote that never closes is a literal character and
//     the text after it is read again as unquoted (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds the records after it (every record when
//     header is false), each padded with "" (short_row) or cut (long_row) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record starts on (every LF, CRLF and lone CR inside
//     a quoted field counted), row its record's index in rows (null for the header), in the order met.
//
// How it stays fast: fields are cut out of the text with slice() between delimiters instead of being built character
// by character, quoted fields are scanned by jumping from quote to quote with indexOf, and no object is allocated
// per field: the parse state lives in local variables of this one function.

/** csv-reader's answer for one case's input {text, header}: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xFEFF) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    let fields = [];
    let value = '';
    let ended = 0; // 0: at a comma (the record goes on), 1: at a line break, 2: at the end of the text
    let quoted = false;

    // Fast path: a record that sits on one line and holds no quote and no CR of its own in it (the CR of its CRLF
    // ending aside) is cut in one split; anything else takes the field-by-field reading below.
    const lineEnd = text.indexOf('\n', pos);
    const stop = lineEnd === -1 ? n : lineEnd;
    let contentEnd = stop;
    if (lineEnd !== -1 && contentEnd > pos && text.charCodeAt(contentEnd - 1) === 13) contentEnd -= 1;
    if (contentEnd > pos) {
      const q = text.indexOf('"', pos);
      const r = text.indexOf('\r', pos);
      if ((q === -1 || q >= contentEnd) && (r === -1 || r >= contentEnd)) {
        fields = text.slice(pos, contentEnd).split(',');
        if (lineEnd !== -1) line += 1;
        pos = lineEnd === -1 ? n : lineEnd + 1;
      }
    }

    if (fields.length === 0) do {
      quoted = text.charCodeAt(pos) === 34; // '"'
      if (!quoted) {
        // Unquoted field: cut the text between delimiters; a stray CR is dropped out of the cut.
        let seg = pos;
        let parts = null;
        for (;;) {
          if (pos >= n) {
            value = parts === null ? text.slice(seg, pos) : (parts.push(text.slice(seg, pos)), parts.join(''));
            ended = 2;
            break;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) { // ','
            value = parts === null ? text.slice(seg, pos) : (parts.push(text.slice(seg, pos)), parts.join(''));
            pos += 1;
            ended = 0;
            break;
          }
          if (c === 10) { // LF
            value = parts === null ? text.slice(seg, pos) : (parts.push(text.slice(seg, pos)), parts.join(''));
            pos += 1;
            line += 1;
            ended = 1;
            break;
          }
          if (c === 13) { // CR
            if (text.charCodeAt(pos + 1) === 10) {
              value = parts === null ? text.slice(seg, pos) : (parts.push(text.slice(seg, pos)), parts.join(''));
              pos += 2;
              line += 1;
              ended = 1;
              break;
            }
            if (parts === null) parts = [text.slice(seg, pos)];
            else parts.push(text.slice(seg, pos));
            errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
            pos += 1;
            seg = pos;
            continue;
          }
          pos += 1;
        }
      } else {
        // Quoted field: jump from quote to quote; the text between two quotes is taken as one slice, with any CR
        // in it read as LF (a slower cut, only where a CR actually sits between the quotes).
        const open = pos;
        const openLine = line;
        pos += 1;
        let seg = pos;
        let parts = null;
        let closed = false;
        while (pos < n) {
          const q = text.indexOf('"', pos);
          if (q === -1) {
            pos = n;
            break;
          }
          const r = text.indexOf('\r', seg);
          if (r !== -1 && r < q) {
            if (parts === null) parts = [];
            let j = seg;
            let ss = seg;
            while (j < q) {
              const cc = text.charCodeAt(j);
              if (cc === 13) {
                parts.push(text.slice(ss, j), '\n');
                line += 1;
                j += text.charCodeAt(j + 1) === 10 ? 2 : 1;
                ss = j;
              } else {
                if (cc === 10) line += 1;
                j += 1;
              }
            }
            parts.push(text.slice(ss, q));
            seg = q;
          } else {
            let f = text.indexOf('\n', seg);
            while (f !== -1 && f < q) {
              line += 1;
              f = text.indexOf('\n', f + 1);
            }
          }
          if (text.charCodeAt(q + 1) === 34) {
            // A doubled quote: one literal quote in the value, and the field runs on.
            if (parts === null) parts = [text.slice(seg, q), '"'];
            else parts.push(text.slice(seg, q), '"');
            pos = q + 2;
            seg = pos;
            continue;
          }
          closed = true;
          pos = q + 1;
          value = parts === null ? text.slice(seg, q) : (parts.push(text.slice(seg, q)), parts.join(''));
          break;
        }
        if (!closed) {
          // The quote never closes: it is a literal character, and the text after it is read again as unquoted.
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          pos = open + 1;
          line = openLine;
          let useg = pos;
          const uparts = ['"'];
          for (;;) {
            if (pos >= n) {
              value = (uparts.push(text.slice(useg, pos)), uparts.join(''));
              ended = 2;
              break;
            }
            const c = text.charCodeAt(pos);
            if (c === 44) {
              value = (uparts.push(text.slice(useg, pos)), uparts.join(''));
              pos += 1;
              ended = 0;
              break;
            }
            if (c === 10) {
              value = (uparts.push(text.slice(useg, pos)), uparts.join(''));
              pos += 1;
              line += 1;
              ended = 1;
              break;
            }
            if (c === 13) {
              if (text.charCodeAt(pos + 1) === 10) {
                value = (uparts.push(text.slice(useg, pos)), uparts.join(''));
                pos += 2;
                line += 1;
                ended = 1;
                break;
              }
              uparts.push(text.slice(useg, pos));
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              pos += 1;
              useg = pos;
              continue;
            }
            pos += 1;
          }
        } else if (pos >= n) {
          ended = 2;
        } else {
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos += 1;
            ended = 0;
          } else if (c === 10) {
            pos += 1;
            line += 1;
            ended = 1;
          } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line += 1;
            ended = 1;
          } else {
            // What follows the closing quote is appended as it stands, up to the next comma or line break.
            let jseg = pos;
            const jparts = [value];
            let kept = 0;
            for (;;) {
              if (pos >= n) {
                kept += pos - jseg;
                value = (jparts.push(text.slice(jseg, pos)), jparts.join(''));
                ended = 2;
                break;
              }
              const cc = text.charCodeAt(pos);
              if (cc === 44) {
                kept += pos - jseg;
                value = (jparts.push(text.slice(jseg, pos)), jparts.join(''));
                pos += 1;
                ended = 0;
                break;
              }
              if (cc === 10) {
                kept += pos - jseg;
                value = (jparts.push(text.slice(jseg, pos)), jparts.join(''));
                pos += 1;
                line += 1;
                ended = 1;
                break;
              }
              if (cc === 13) {
                if (text.charCodeAt(pos + 1) === 10) {
                  kept += pos - jseg;
                  value = (jparts.push(text.slice(jseg, pos)), jparts.join(''));
                  pos += 2;
                  line += 1;
                  ended = 1;
                  break;
                }
                jparts.push(text.slice(jseg, pos));
                kept += pos - jseg;
                errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
                pos += 1;
                jseg = pos;
                continue;
              }
              pos += 1;
            }
            if (kept > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
          }
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
