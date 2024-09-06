
// Comment States Bitmask
const CommentStates = {
  None: 0,
  Multiline: 1 << 0,
  Html: 1 << 1,
  JsDoc: 1 << 2,
  String: 1 << 3,
  RegExp: 1 << 4,
  JsxExpression: 1 << 5,
  TemplateLiteral: 1 << 6,
  Expression: 1 << 7, // Inside expression within template literal
  ArrayLiteral: 1 << 8,
  ClassDeclaration: 1 << 9,
  InClassDeclaration: 1 << 10, // Inside a class declaration
  GeneratorState: 1 << 11, // Inside a generator function
  JsxFragment: 1 << 12, // Inside a JSX fragment
  TemplateLiteralComment: 1 << 13, // Inside a comment within a template literal
};

// Punctuator States Bitmask
const PunctuatorStates = {
  None: 0,
  Dot: 1,
  Comma: 2,
  QuestionMark: 4,
  ExclamationMark: 8,
  Colon: 16,
  Semicolon: 32,
  Parenthesis: 64,
  Bracket: 128,
  CurlyBrace: 256,
  Plus: 512,
  Minus: 1024,
  Star: 2048,
  Slash: 4096,
  Percent: 8192,
  DoubleStar: 16384,
  TripleEquals: 32768,
  NotEquals: 65536,
  DoubleEquals: 131072,
  NotDoubleEquals: 262144,
  GreaterThan: 524288,
  LessThan: 1048576,
  GreaterThanEquals: 2097152,
  LessThanEquals: 4194304,
  DoubleAmpersand: 8388608,
  DoublePipe: 16777216,
  Exclamation: 33554432,
  Equals: 67108864,
  PlusEquals: 134217728,
  MinusEquals: 268435456,
  StarEquals: 536870912,
  SlashEquals: 1073741824,
  PercentEquals: -2147483648, // Note: Using negative value to avoid overflow
  DoubleStarEquals: 1, // Use a different bit (wrapping around) for 32nd bit
  Ampersand: 2,
  Pipe: 4,
  Caret: 8,
  Tilde: 16,
  LeftShift: 32,
  RightShift: 64,
  UnsignedRightShift: 128,
  Question: 256,
  Colon2: 512,
  Ellipsis: 1024,
  Increment: 2048,
  Decrement: 4096,
  Typeof: 8192,
  Instanceof: 16384,
  In: 32768,
  DollarSign: 65536,
  AtSign: 131072,
  Backtick: 262144,
};

// Lookup table for punctuators (for faster access)
const punctuatorLookup = new Map<number, number>();

// Populate the lookup table
for (const [key, value] of Object.entries(PunctuatorStates)) {
  punctuatorLookup.set(parseInt(key.replace('PunctuatorStates.', ''), 10), value);
}

// Lookup tables for optimized character type checks
const lineBreakLookup = new Uint8Array([
  0x0A, 0x0D, // Line Feed (LF), Carriage Return (CR)
]);
const stringQuoteLookup = new Uint8Array([
  0x22, 0x27, 0x60, // " or ' or ` 
]);

// Comment Data Type
interface Comment {
  start: number;
  end: number;
  loc: { start: { line: number, column: number }, end: { line: number, column: number } };
  type: 'multiline' | 'singleline' | 'jsdoc' | 'html' | 'hashbang' | 'templateLiteral' | 'unterminatedString' | 'unterminatedRegExp';
  nested: boolean;
}

// Function to collect comments on demand based on previous and next token positions
function collectComments(
  source: string,
  previousTokenEnd: number,
  nextTokenStart: number,
  options: { commentTypes: 'all' | 'singleline' | 'multiline' | 'html' | 'jsdoc'; } = { commentTypes: 'all', }
): Comment[] {
  const comments: Comment[] = [];
  let commentState = CommentStates.None;
  let commentStart = -1;
  let punctuatorState = PunctuatorStates.None;
  let currentLine = 1;
  let currentColumn = 0;
  let inMultilineComment = false;
  let nestingLevel = 0;
  let inJsxAttribute = false;
  let templateLiteralNestingLevel = 0; 

  // Optimized helper variables
  let c1, c2, ck, nextCharCode;
  let lines: number[] = []; 
  let startColumn: number;
  let endIndex: number;
  let endColumn: number;
  let tempComment: Comment | undefined = undefined; 

  // Handle comments at the beginning of the code
  if (previousTokenEnd === 0) {
    for (let i = 0; i < source.length; i++) {
      c1 = source.charCodeAt(i);
      c2 = source.charCodeAt(i + 1);
      if (c1 === 0x2F && (c2 === 0x2A || c2 === 0x2F)) {
        commentState = c2 === 0x2A ? CommentStates.Multiline : CommentStates.None;
        commentStart = i;
        startColumn = currentColumn; 
        i += commentState === CommentStates.Multiline ? 2 : 1;
        break;
      } else if (c1 === 0x23 && c2 === 0x21) { 
        commentState = CommentStates.None;
        commentStart = i;
        j = i + 2;
        while (j < source.length && (source.charCodeAt(j) !== 0x0A && source.charCodeAt(j) !== 0x0D)) {
          j++;
        }

        // Reuse or create a new comment object
        if (!tempComment) {
          tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
          comments.push(tempComment);
        }
        tempComment.start = i;
        tempComment.end = j;
        tempComment.loc.start.line = currentLine;
        tempComment.loc.start.column = currentColumn;
        tempComment.loc.end.line = currentLine;
        tempComment.loc.end.column = j;
        tempComment.lines = [currentLine];
        tempComment.type = 'hashbang';
        tempComment.nested = false;

        i = j - 1;
        currentColumn = j;
        break; 
      } else if (c1 === 0x0A || (c1 === 0x0D && source.charCodeAt(i + 1) !== 0x0A)) {
        currentLine++;
        currentColumn = 0; 
      } else if (c1 === 0x0D && source.charCodeAt(i + 1) === 0x0A) { 
        currentLine++;
        currentColumn = 0;
        i++; 
      } else {
        currentColumn++;
      }
    }

    if (commentState & CommentStates.Multiline && commentStart >= 0) {
      lines = [currentLine];
      startColumn = currentColumn;
      for (let k = commentStart; k < source.length && !(source[k] === '*' && source[k + 1] === '/'); k++) {
        ck = source.charCodeAt(k)
        if (ck === 0x0A || (ck === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) {
          lines.push(++currentLine);
          currentColumn = 0; 
        } else if (ck === 0x0D && source.charCodeAt(k + 1) === 0x0A) {
          lines.push(++currentLine);
          currentColumn = 0;
          k++; 
        } else {
          currentColumn++;
        }
      }

      endIndex = source.length;
      endColumn = currentColumn; 
      if (source[k] === '*' && source[k + 1] === '/') {
        endIndex = k + 2;
        endColumn += 2; 
        inMultilineComment = false;
        nestingLevel = 0;
      }

      // Reuse or create a new comment object
      if (!tempComment) {
        tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
        comments.push(tempComment);
      }
      tempComment.start = commentStart;
      tempComment.end = endIndex;
      tempComment.loc.start.line = lines[0];
      tempComment.loc.start.column = startColumn;
      tempComment.loc.end.line = lines[lines.length - 1];
      tempComment.loc.end.column = endColumn;
      tempComment.lines = lines; 
      tempComment.type = 'multiline';
      tempComment.nested = false; 
    }

    // Handle regular expressions
    if (
      charCode === 0x2F && // '/'
      !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html))
    ) {
      if (commentState & CommentStates.RegExp) {
        if (source[i + 1] === 0x2F) { // '/'
          if (
            i + 2 < source.length &&
            !['i', 'm', 's', 'u', 'y', 'g'].includes(source[i + 2])
          ) {
            commentState &= ~CommentStates.RegExp;

            // Handle unterminated regular expressions at the end of the code
            if (i === nextTokenStart - 1 && nextTokenStart === source.length) {
              comments.push({
                start: commentStart,
                end: source.length,
                loc: {
                  start: { line: currentLine, column: commentStart },
                  end: { line: currentLine, column: source.length }
                },
                lines: [currentLine],
                type: 'unterminatedRegExp',
                nested: false,
              });
            }
          }
        } else if (source[i + 1] !== '*' && source[i + 1] !== '?') {
          commentState &= ~CommentStates.RegExp;
        }
      } else {
        if (
          source[i + 1] !== '/' &&
          source[i + 1] !== '*' &&
          source[i + 1] !== '?'
        ) {
          commentState |= CommentStates.RegExp;
          commentStart = i; // Track the start of the regular expression for potential unterminated cases
        }
      }
    }

    // Skip processing comment start markers if inside a regular expression or JSX attribute
    if ((commentState & CommentStates.RegExp) || inJsxAttribute) {
      continue;
    }

    // Handle multiline comments (inline findMultilineCommentEnd)
    if (charCode === 0x2F && source[i + 1] === '*' && !isEscaped) {
      if (options.commentTypes === 'all' || options.commentTypes === 'multiline') {
        if (inMultilineComment) {
          nestingLevel++;
        } else {
          if (i + 2 < source.length && source[i + 2] !== '#') { 
            inMultilineComment = true;
            commentStart = i;
            nestingLevel = 1; 
            startColumn = currentColumn; 

            // Inline findMultilineCommentEnd
            for (j = i + 1; j < source.length; j++) {
              if (source[j] === '*' && source[j + 1] === '/') {
                i = j;
                break;
              } 
            }

            // Track lines for multi-line comments
            lines = [currentLine]; 
            endColumn = 0; 
            for (let k = commentStart; k <= i + 1; k++) {
              if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) { 
                lines.push(++currentLine);
                endColumn = 0; 
              } else if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { 
                k++; 
              } else {
                endColumn++;
              }
            }

            endIndex = i + 2;

            // Reuse or create a new comment object
            if (!tempComment) {
              tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
              comments.push(tempComment);
            }
            tempComment.start = commentStart;
            tempComment.end = endIndex;
            tempComment.loc.start.line = lines[0];
            tempComment.loc.start.column = startColumn;
            tempComment.loc.end.line = lines[lines.length - 1];
            tempComment.loc.end.column = endColumn;
            tempComment.lines = lines; 
            tempComment.type = 'multiline';
            tempComment.nested = nestingLevel > 1;
          }
        }
      }
      i++;
    } else if (inMultilineComment) {
      if (charCode === 0x2A && source[i + 1] === 0x2F) {
        nestingLevel--;

        if (nestingLevel === 0) {
          inMultilineComment = false;

          if (tempComment) {
            tempComment.end = i + 2;
            tempComment.loc.end.line = currentLine;
            tempComment.loc.end.column = currentColumn + 2;
          } else {
            console.error("Error: Unexpected end of multiline comment.");
          }
        }
        i++;
      } else if (charCode === 0x0A || (charCode === 0x0D && source.charCodeAt(i + 1) !== 0x0A)) { 
        currentLine++;
        currentColumn = 0; 
      } else if (charCode === 0x0D && source.charCodeAt(i + 1) === 0x0A) {
        currentLine++;
        currentColumn = 0;
        i++; 
      } else {
        currentColumn++;
      }
    } else if (
      charCode === 0x3C && 
      source[i + 1] === '!' &&
      source[i + 2] === '-' &&
      source[i + 3] === '-' && 
      !isEscaped 
    ) {
      // Handle HTML comments 
      if (options.commentTypes === 'all' || options.commentTypes === 'html') {
        commentState |= CommentStates.Html;
        commentStart = i;
        nestingLevel = 1; 
        startColumn = currentColumn; 
      }
      i += 3;
    } else if (commentState & CommentStates.Html) {
      if (source[i] === '-' && source[i + 1] === '-' && source[i + 2] === '>') {
        commentState &= ~CommentStates.Html;
        nestingLevel--; 

        if (nestingLevel === 0) {
          
          endColumn = currentColumn + 3; // Account for '-->'

          // Reuse or create a new comment object
          if (!tempComment) {
            tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
            comments.push(tempComment);
          }
          tempComment.start = commentStart;
          tempComment.end = i + 3;
          tempComment.loc.start.line = currentLine;
          tempComment.loc.start.column = startColumn;
          tempComment.loc.end.line = currentLine;
          tempComment.loc.end.column = endColumn;
          tempComment.lines = [currentLine]; // Assuming single-line for now (can be enhanced)
          tempComment.type = 'html';
          tempComment.nested = nestingLevel > 0;
        }
        i += 2;
      } else if (source[i] === '<' && source[i + 1] === '!' && source[i + 2] === '-' && source[i + 3] === '-') {
        nestingLevel++;
        i += 3;
      } else if (charCode === 0x0A || (charCode === 0x0D && source.charCodeAt(i + 1) !== 0x0A)) { 
        currentLine++;
        currentColumn = 0; 
      } else if (charCode === 0x0D && source.charCodeAt(i + 1) === 0x0A) { 
        currentLine++;
        currentColumn = 0;
        i++; 
      } else {
        currentColumn++;
      }
    } else if (
      charCode === 0x2A && // '*'
      source[i + 1] === '/' && // '/'
      !(commentState & (CommentStates.Multiline | CommentStates.Html)) &&
      !isEscaped
    ) {
      // Handle JSDoc comments 
      if (options.commentTypes === 'all' || options.commentTypes === 'jsdoc') {
        commentState |= CommentStates.JsDoc;
        commentStart = i - 1;
      }
      i++;

      // Track lines for JSDoc comments
      const lines: number[] = [currentLine];
      for (let k = commentStart; k <= i; k++) {
        if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) {
          lines.push(++currentLine);
        }
        if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
          k++; // Skip LF after CR
        }
      }

      // Reuse or create a new comment object
      if (!tempComment) {
        tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
        comments.push(tempComment);
      }
      tempComment.start = commentStart;
      tempComment.end = i;
      tempComment.loc.start.line = lines[0];
      tempComment.loc.start.column = currentColumn - 2; // Adjust for '/*'
      tempComment.loc.end.line = lines[lines.length - 1];
      tempComment.loc.end.column = currentColumn; 
      tempComment.lines = lines; 
      tempComment.type = 'jsdoc';
      tempComment.nested = nestingLevel > 0;
    } else if (commentState & CommentStates.JsDoc && (charCode === lineBreakLookup[0] || charCode === lineBreakLookup[1])) {
      commentState &= ~CommentStates.JsDoc;

      // Track lines for JSDoc comments
      const lines: number[] = [currentLine];
      for (let k = commentStart; k <= i - 1; k++) {
        if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) {
          lines.push(++currentLine);
        }
        if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
          k++; // Skip LF after CR
        }
      }

      // Reuse or create a new comment object
      if (!tempComment) {
        tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
        comments.push(tempComment);
      }
      tempComment.start = commentStart;
      tempComment.end = i;
      tempComment.loc.start.line = lines[0];
      tempComment.loc.start.column = currentColumn - 2;
      tempComment.loc.end.line = lines[lines.length - 1];
      tempComment.loc.end.column = currentColumn; 
      tempComment.lines = lines;
      tempComment.type = 'jsdoc';
      tempComment.nested = nestingLevel > 0;
    } else if (commentState & CommentStates.JsDoc) {
      if (charCode === lineBreakLookup[0] || charCode === lineBreakLookup[1]) {
        currentLine++;
        currentColumn = 0; 
      } else {
        currentColumn++;
      }
    } else if (
      charCode === 0x2F && // '/'
      source[i + 1] === '/' && // '/'
      !(commentState & (CommentStates.Multiline | CommentStates.Html | CommentStates.JsDoc)) &&
      !isEscaped
    ) {
      // Handle single-line comments 
      if (options.commentTypes === 'all' || options.commentTypes === 'singleline') {
        // Inline isLineBreak and unroll first few iterations
        for (j = i + 2; j < source.length; j++) {
          const nextCharCode = source.charCodeAt(j);
          if (nextCharCode === lineBreakLookup[0] || nextCharCode === lineBreakLookup[1]) {
            break;
          }
        }

        // Reuse or create a new comment object
        if (!tempComment) {
          tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
          comments.push(tempComment);
        }
        tempComment.start = i;
        tempComment.end = j;
        tempComment.loc.start.line = currentLine;
        tempComment.loc.start.column = currentColumn;
        tempComment.loc.end.line = currentLine;
        tempComment.loc.end.column = j; 
        tempComment.lines = [currentLine];
        tempComment.type = 'singleline';
        tempComment.nested = false; 

        i = j - 1;
        currentColumn = j; // Update the current column after the comment
      }
    } else if (charCode === 0x23 && source[i + 1] === 0x21 && i === 0) { // Hashbang comment
      if (options.commentTypes === 'all' || options.commentTypes.includes('singleline')) {
        let j = i + 2;
        while (j < source.length && (source.charCodeAt(j) !== lineBreakLookup[0] && source.charCodeAt(j) !== lineBreakLookup[1])) {
          j++;
        }

        // Reuse or create a new comment object
        if (!tempComment) {
          tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
          comments.push(tempComment);
        }
        tempComment.start = i;
        tempComment.end = j;
        tempComment.loc.start.line = currentLine;
        tempComment.loc.start.column = currentColumn;
        tempComment.loc.end.line = currentLine;
        tempComment.loc.end.column = j;
        tempComment.lines = [currentLine];
        tempComment.type = 'hashbang';
        tempComment.nested = false;

        i = j - 1;
        currentColumn = j;
      } else if (charCode === lineBreakLookup[0] || charCode === lineBreakLookup[1]) {
        currentLine++;
        currentColumn = 0;

        // Reset isEscaped and inEscapeSequence after encountering a newline
        isEscaped = false;
        inEscapeSequence = false;
      } else {
        // Handle punctuators here (use lookup table for faster access)
        punctuatorState |= punctuatorLookup.get(charCode) || 0;

        // Check for comment start markers after punctuators
        if (charCode === 0x2F && source[i + 1] === '/' && !isEscaped) {
          // Handle single-line comments 
          if (options.commentTypes === 'all' || options.commentTypes === 'singleline') {
            // Inline isLineBreak and unroll first few iterations
            for (j = i + 2; j < source.length; j++) {
              const nextCharCode = source.charCodeAt(j);
              if (nextCharCode === lineBreakLookup[0] || nextCharCode === lineBreakLookup[1]) {
                break;
              }
            }

            // Reuse or create a new comment object
            if (!tempComment) {
              tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
              comments.push(tempComment);
            }
            tempComment.start = i;
            tempComment.end = j;
            tempComment.loc.start.line = currentLine;
            tempComment.loc.start.column = currentColumn;
            tempComment.loc.end.line = currentLine;
            tempComment.loc.end.column = j; 
            tempComment.lines = [currentLine];
            tempComment.type = 'singleline';
            tempComment.nested = false; 

            i = j - 1;
            currentColumn = j; 
          }
        } else if (
          charCode === 0x2A && 
          source[i + 1] === '/' &&
          !(commentState & (CommentStates.Multiline | CommentStates.Html)) &&
          !isEscaped 
        ) {
          // Handle JSDoc comments 
          if (options.commentTypes === 'all' || options.commentTypes === 'jsdoc') {
            commentState |= CommentStates.JsDoc;
            commentStart = i - 1;
          }
          i++;

          // Track lines for JSDoc comments
          const lines: number[] = [currentLine];
          for (let k = commentStart; k <= i; k++) {
            if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) {
              lines.push(++currentLine);
            }
            if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
              k++; // Skip LF after CR
            }
          }

          // Reuse or create a new comment object
          if (!tempComment) {
            tempComment = { start: 0, end: 0, loc: { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } }, lines: [], type: '', nested: false };
            comments.push(tempComment);
          }
          tempComment.start = commentStart;
          tempComment.end = i;
          tempComment.loc.start.line = lines[0];
          tempComment.loc.start.column = currentColumn - 2; 
          tempComment.loc.end.line = lines[lines.length - 1];
          tempComment.loc.end.column = currentColumn; 
          tempComment.lines = lines; 
          tempComment.type = 'jsdoc';
          tempComment.nested = nestingLevel > 0;
        }

        // Reset isEscaped and inEscapeSequence after handling any character within a string or template literal
        if (commentState & (CommentStates.String | CommentStates.TemplateLiteral)) {
          isEscaped = false;
          inEscapeSequence = false; 
        }

        currentColumn++;
      }

    // Handle unterminated multi-line and HTML comments at the end of the code
    if (nextTokenStart === source.length) {
      if (inMultilineComment && commentStart >= 0) {
        // Track lines for unterminated multi-line comments
        const lines: number[] = [currentLine];
        for (let k = commentStart; k < source.length; k++) {
          if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) { 
            lines.push(++currentLine);
          }
          if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
            k++; // Skip LF after CR
          }
        }

        comments.push({
          start: commentStart,
          end: source.length,
          loc: {
            start: { line: lines[0], column: startColumn },
            end: { line: lines[lines.length - 1], column: source.length - commentStart } 
          },
          lines,
          type: 'multiline',
          nested: nestingLevel > 1,
        });
      } else if (commentState & CommentStates.Html && commentStart >= 0) {
        // Track lines for unterminated HTML comments
        const lines: number[] = [currentLine];
        for (let k = commentStart; k < source.length; k++) {
          if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) {
            lines.push(++currentLine);
          }
          if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
            k++; // Skip LF after CR
          }
        }

        comments.push({
          start: commentStart,
          end: source.length,
          loc: {
            start: { line: lines[0], column: startColumn },
            end: { line: lines[lines.length - 1], column: source.length - commentStart } 
          },
          lines,
          type: 'html',
          nested: nestingLevel > 0,
        });
      } else if (commentState & CommentStates.String && quoteChar && commentStart >= 0) {
        // Handle unterminated strings
        comments.push({
          start: commentStart,
          end: source.length,
          loc: {
            start: { line: currentLine, column: commentStart },
            end: { line: currentLine, column: source.length }
          },
          lines: [currentLine], 
          type: 'unterminatedString',
          nested: false,
        });
      } else if (commentState & CommentStates.RegExp && commentStart >= 0) {
        // Handle unterminated regular expressions
        comments.push({
          start: commentStart,
          end: source.length,
          loc: {
            start: { line: currentLine, column: commentStart },
            end: { line: currentLine, column: source.length }
          },
          lines: [currentLine],
          type: 'unterminatedRegExp',
          nested: false,
        });
} else if ((commentState & CommentStates.TemplateLiteral) && commentStart >= 0) {
  // Handle unterminated template literals
  comments.push({
    start: commentStart, 
    end: source.length,
    loc: {
    start: { line: currentLine, column: commentStart },
    end: { line: currentLine, column: source.length }
    },
    lines: [currentLine],
    type: 'templateLiteral', 
    nested: false, 
  });
} 
}

return comments;
}

// Helper function to find the end of a multiline comment
function findMultilineCommentEnd(source: string, start: number): number {
for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '*' && source[i + 1] === '/') {
    return i + 1;
    }
}
return -1; // Indicates an unterminated multi-line comment
}

