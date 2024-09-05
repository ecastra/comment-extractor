
// comments.ts

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

// Comment Data Type
interface Comment {
  start: number;
  end: number;
  lines: number[];
  type: 'multiline' | 'singleline' | 'jsdoc' | 'html';
}

// Function to collect comments on demand based on previous and next token positions
function collectComments(source: string, previousTokenEnd: number, nextTokenStart: number): Comment[] {
  const comments: Comment[] = [];
  let commentState = CommentStates.None;
  let commentStart = -1;
  let punctuatorState = PunctuatorStates.None;
  let currentLine = 0; // Track the current line number

  // Helper functions to determine character types
  const isLineBreak = (charCode: number) => charCode === 0x0A || charCode === 0x0D || (charCode === 0x0D && source.charCodeAt(i + 1) === 0x0A);
  const isStringQuote = (charCode: number) => charCode === 0x22 || charCode === 0x27 || charCode === 0x60; // " or ' or `
  const isUnicodeWhitespace = (charCode: number) => charCode >= 0x09 && charCode <= 0x0D || charCode === 0x20 || (charCode >= 0x85 && charCode <= 0xA0);

  // Handle comments at the beginning of the code
  if (previousTokenEnd === 0) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '/' && (source[i + 1] === '*' || source[i + 1] === '/')) {
        // Optimized check for single-line or multi-line comment start
        commentState = source[i + 1] === '*' ? CommentStates.Multiline : CommentStates.None;
        commentStart = i;
        i += commentState === CommentStates.Multiline ? 2 : 1; // Skip '/' or '/*' 
        break;
      }
    }
  }

  let quoteChar = null; // Track quote character for string literals

  // Main loop to process the code
  for (let i = previousTokenEnd; i < nextTokenStart; i++) {
    const charCode = source.charCodeAt(i);

    // Handle string literals and template literals
    if (isStringQuote(charCode)) {
      if (commentState & CommentStates.String) {
        if (source[i] === quoteChar) {
          commentState &= ~CommentStates.String;
          quoteChar = null;
        }
      } else {
        commentState |= CommentStates.String;
        quoteChar = source[i];
      }
    }

    if (commentState & CommentStates.String) { continue; }

    // Handle template literals
    if (charCode === 0x60 && !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp))) {
      commentState |= CommentStates.TemplateLiteral;
    } else if (commentState & CommentStates.TemplateLiteral && charCode === 0x60) {
      commentState &= ~CommentStates.TemplateLiteral;
    }

    // Handle expressions inside template literals
    if (commentState & CommentStates.TemplateLiteral && charCode === 0x24 && source[i + 1] === 0x7B) {
      commentState |= CommentStates.Expression;
      i++;
    } else if (commentState & CommentStates.TemplateLiteral && (commentState & CommentStates.Expression) && charCode === 0x7D) {
      commentState &= ~CommentStates.Expression;
    }

    // Handle JSX expressions
    if (charCode === 0x7B && !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp))) {
      commentState |= CommentStates.JsxExpression;
    } else if (charCode === 0x7D && commentState & CommentStates.JsxExpression) {
      commentState &= ~CommentStates.JsxExpression;
    }

    // Handle array literals
    if (charCode === 0x5B && !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp | CommentStates.JsxExpression))) {
      commentState |= CommentStates.ArrayLiteral;
    } else if (charCode === 0x5D && commentState & CommentStates.ArrayLiteral) {
      commentState &= ~CommentStates.ArrayLiteral;
    }

    // Handle class declarations
    if (charCode === 0x43 && source[i + 1] === 0x6C && source[i + 2] === 0x61 && source[i + 3] === 0x73 && source[i + 4] === 0x73 &&
        !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp | CommentStates.JsxExpression | CommentStates.ArrayLiteral))) {
      commentState |= CommentStates.ClassDeclaration;
      i += 4;
    } else if (commentState & CommentStates.ClassDeclaration && charCode === 0x7B) {
      commentState |= CommentStates.InClassDeclaration;
      i += 1;
    } else if (commentState & CommentStates.InClassDeclaration && charCode === 0x7D) {
      commentState &= ~CommentStates.InClassDeclaration;
      commentState &= ~CommentStates.ClassDeclaration;
    }

    // Handle regular expressions
    if (charCode === 0x2F && !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html))) {
      if (commentState & CommentStates.RegExp) {
        if (source[i + 1] === 0x2F) {
          if (i + 2 < source.length && !['i', 'm', 's', 'u', 'y', 'g'].includes(source[i + 2])) {
            commentState &= ~CommentStates.RegExp;
          }
        } else if (source[i + 1] !== '*' && source[i + 1] !== '?') {
          commentState &= ~CommentStates.RegExp;
        }
      } else {
        if (source[i + 1] !== '/' && source[i + 1] !== '*' && source[i + 1] !== '?') {
          commentState |= CommentStates.RegExp;
        }
      }
    }

    if (commentState & CommentStates.RegExp) { continue; }

    // Handle multiline comments
    if (charCode === 0x2F && source[i + 1] === '*') {
      if (commentState & CommentStates.Multiline) {
        i = findMultilineCommentEnd(source, i) - 1;
      } else {
        commentState |= CommentStates.Multiline;
        commentStart = i;
      }
      i++;
    } else if (commentState & CommentStates.Multiline) {
      if (source[i] === '*' && source[i + 1] === '/') {
        commentState &= ~CommentStates.Multiline;
        comments.push({ start: commentStart, end: i + 2, lines: [currentLine, ...], type: 'multiline' });
        i++;
      }
    } else if (charCode === 0x3C && source[i + 1] === '!' && source[i + 2] === '-' && source[i + 3] === '-') {
      commentState |= CommentStates.Html;
      commentStart = i;
      i += 3;
      comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'html' });
    } else if (commentState & CommentStates.Html) {
      if (source[i] === '-' && source[i + 1] === '-' && source[i + 2] === '>') {
        commentState &= ~CommentStates.Html;
        comments.push({ start: commentStart, end: i + 3, lines: [currentLine, ...], type: 'html' });
        i += 2;
      }
    } else if (charCode === 0x2A && source[i + 1] === '/' && !(commentState & (CommentStates.Multiline | CommentStates.Html))) {
      commentState |= CommentStates.JsDoc;
      commentStart = i - 1;
      i++;
    } else if (commentState & CommentStates.JsDoc && isLineBreak(charCode)) {
      commentState &= ~CommentStates.JsDoc;
      comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'jsdoc' });
    } else if (commentState & CommentStates.JsDoc) {
      if (isLineBreak(charCode)) {
        currentLine++;
      } else {
        i++;
      }
    } else if (charCode === 0x2F && source[i + 1] === '/' && !(commentState & (CommentStates.Multiline | CommentStates.Html | CommentStates.JsDoc))) {
      let j = i + 2;
      while (j < source.length && !isLineBreak(source.charCodeAt(j))) { j++; }
      comments.push({ start: i, end: j, lines: [currentLine, ...], type: 'singleline' });
      i = j - 1;
    } else if (isLineBreak(charCode)) {
      currentLine++;
    } else {
      // Handle punctuators here
      switch (charCode) {
        case 0x2E: // '.'
          punctuatorState |= PunctuatorStates.Dot;
          break;
        case 0x2C: // ','
          punctuatorState |= PunctuatorStates.Comma;
          break;
        case 0x3F: // '?'
          punctuatorState |= PunctuatorStates.QuestionMark;
          break;
        case 0x21: // '!'
          punctuatorState |= PunctuatorStates.ExclamationMark;
          break;
        case 0x3A: // ':'
          punctuatorState |= PunctuatorStates.Colon;
          break;
        case 0x3B: // ';'
          punctuatorState |= PunctuatorStates.Semicolon;
          break;
        case 0x28: // '('
        case 0x29: // ')'
          punctuatorState |= PunctuatorStates.Parenthesis;
          break;
        case 0x5B: // '['
        case 0x5D: // ']'
          punctuatorState |= PunctuatorStates.Bracket;
          break;
        case 0x7B: // '{'
        case 0x7D: // '}'
          punctuatorState |= PunctuatorStates.CurlyBrace;
          break;
        case 0x2B: // '+'
          punctuatorState |= PunctuatorStates.Plus;
          break;
        case 0x2D: // '-'
          punctuatorState |= PunctuatorStates.Minus;
          break;
        case 0x2A: // '*'
          punctuatorState |= PunctuatorStates.Star;
          break;
        case 0x2F: // '/'
          punctuatorState |= PunctuatorStates.Slash;
          break;
        case 0x25: // '%'
          punctuatorState |= PunctuatorStates.Percent;
          break;
        case 0x26: // '&'
          punctuatorState |= PunctuatorStates.Ampersand;
          break;
        case 0x7C: // '|'
          punctuatorState |= PunctuatorStates.Pipe;
          break;
        case 0x5E: // '^'
          punctuatorState |= PunctuatorStates.Caret;
          break;
        case 0x7E: // '~'
          punctuatorState |= PunctuatorStates.Tilde;
          break;
        case 0x3C: // '<'
          punctuatorState |= PunctuatorStates.LessThan;
          break;
        case 0x3E: // '>'
          punctuatorState |= PunctuatorStates.GreaterThan;
          break;
        case 0x3D: // '='
          // Handle multi-character punctuators like '===' or '!='
          if (source[i + 1] === '=') {
            if (source[i + 2] === '=') {
              punctuatorState |= PunctuatorStates.TripleEquals;
              i += 2;
            } else {
              punctuatorState |= PunctuatorStates.DoubleEquals;
              i += 1;
            }
          } else if (source[i + 1] === '!') {
            punctuatorState |= PunctuatorStates.NotEquals;
            i += 1;
          } else {
            punctuatorState |= PunctuatorStates.Equals;
          }
          break;
        case 0x22: // '"'
          // Handle multi-character punctuators like '++' or '--'
          if (source[i + 1] === '+') {
            punctuatorState |= PunctuatorStates.Increment;
            i += 1;
          } else if (source[i + 1] === '-') {
            punctuatorState |= PunctuatorStates.Decrement;
            i += 1;
          }
          break;
        case 0x3F: // '?'
          if (source[i + 1] === '?') {
            punctuatorState |= PunctuatorStates.Question;
            i += 1;
          }
          break;
        case 0x3A: // ':'
          if (source[i + 1] === ':') {
            punctuatorState |= PunctuatorStates.Colon2;
            i += 1;
          }
          break;
        case 0x2E: // '.'
          if (source[i + 1] === '.' && source[i + 2] === '.') {
            punctuatorState |= PunctuatorStates.Ellipsis;
            i += 2;
          }
          break;
        case 0x40: // '@'
          punctuatorState |= PunctuatorStates.AtSign;
          break;
        case 0x60: // '`'
          punctuatorState |= PunctuatorStates.Backtick;
          break;
        default:
          i++;
          break;
      }
    }
  }

  // Handle comments at the end of the code
  if (nextTokenStart === source.length) {
    for (let i = source.length - 1; i >= 0; i--) {
      if (source[i] === '/' && (source[i - 1] === '*' || source[i - 1] === '/')) {
        // Optimized check for single-line or multi-line comment end
        commentState = source[i - 1] === '*' ? CommentStates.Multiline : CommentStates.None;
        commentStart = i - 1;
        break;
      }
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
  return -1;
}
