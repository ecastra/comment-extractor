
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
  lines: number[];
  type: 'multiline' | 'singleline' | 'jsdoc' | 'html';
}

// Function to collect comments on demand based on previous and next token positions
function collectComments(
  source: string,
  previousTokenEnd: number,
  nextTokenStart: number,
  options: {
    commentTypes: 'all' | 'singleline' | 'multiline' | 'html' | 'jsdoc';
  } = {
    commentTypes: 'all',
  }
): Comment[] {
  const comments: Comment[] = [];
  let commentState = CommentStates.None;
  let commentStart = -1;
  let punctuatorState = PunctuatorStates.None;
  let currentLine = 0; // Track the current line number
  let inMultilineComment = false; // Flag to track if we are inside a multiline comment

  // Optimized character type checks
  const isLineBreak = (charCode: number) => lineBreakLookup.includes(charCode);
  const isStringQuote = (charCode: number) => stringQuoteLookup.includes(charCode);

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

    if (commentState & CommentStates.String) {
      continue;
    }

    // Handle template literals
    if (
      charCode === 0x60 &&
      !(
        commentState &
        (CommentStates.String |
          CommentStates.TemplateLiteral |
          CommentStates.Multiline |
          CommentStates.Html |
          CommentStates.RegExp)
      )
    ) {
      commentState |= CommentStates.TemplateLiteral;
    } else if (commentState & CommentStates.TemplateLiteral && charCode === 0x60) {
      commentState &= ~CommentStates.TemplateLiteral;
    }

    // Handle expressions inside template literals
    if (
      commentState & CommentStates.TemplateLiteral &&
      charCode === 0x24 &&
      source[i + 1] === 0x7B
    ) {
      commentState |= CommentStates.Expression;
      i++;
    } else if (
      commentState & CommentStates.TemplateLiteral &&
      (commentState & CommentStates.Expression) &&
      charCode === 0x7D
    ) {
      commentState &= ~CommentStates.Expression;
    }

    // Handle JSX expressions
    if (
      charCode === 0x7B &&
      !(
        commentState &
        (CommentStates.String |
          CommentStates.TemplateLiteral |
          CommentStates.Multiline |
          CommentStates.Html |
          CommentStates.RegExp)
      )
    ) {
      commentState |= CommentStates.JsxExpression;
    } else if (charCode === 0x7D && commentState & CommentStates.JsxExpression) {
      commentState &= ~CommentStates.JsxExpression;
    }

    // Handle JSX Fragments
    if (charCode === 0x3C && source[i + 1] === 0x2F && !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp | CommentStates.JsxExpression))) {
      // If entering a JSX fragment, set the JsxFragment state and capture the start position
      commentState |= CommentStates.JsxFragment;
      commentStart = i;
      i++;
    } else if (commentState & CommentStates.JsxFragment && charCode === 0x3E) {
      // If leaving a JSX fragment, unset the JsxFragment state and add the comment
      commentState &= ~CommentStates.JsxFragment;
      if (commentStart >= 0) {
        // Check for a comment before the closing angle bracket
        const commentBefore = collectComments(source, commentStart, i, options);
        if (commentBefore.length) {
          comments.push(...commentBefore);
        }
      }
      // Capture the end position of the JSX fragment for potential comment after the closing angle bracket
      commentStart = i;
      i++;
    } else if (commentState & CommentStates.JsxFragment) {
      // Capture the start position of the closing angle bracket for potential comment after the closing angle bracket
      commentStart = i;
      i++;
    }

    // Handle array literals
    if (
      charCode === 0x5B &&
      !(
        commentState &
        (CommentStates.String |
          CommentStates.TemplateLiteral |
          CommentStates.Multiline |
          CommentStates.Html |
          CommentStates.RegExp |
          CommentStates.JsxExpression)
      )
    ) {
      commentState |= CommentStates.ArrayLiteral;
    } else if (charCode === 0x5D && commentState & CommentStates.ArrayLiteral) {
      commentState &= ~CommentStates.ArrayLiteral;
    }

    // Handle class declarations and generators
    if (commentState & CommentStates.InClassDeclaration) {
      if (charCode === 0x2A && source[i + 1] === 0x28) { // '*' followed by '('
        commentState |= CommentStates.GeneratorState;
        i++;
      } else if (charCode === 0x2A && source[i + 1] === 0x2F && !(commentState & CommentStates.Multiline)) { // '*/' not ending multiline
        // Skip '*/'
        i++;
      } else if (!(commentState & CommentStates.GeneratorState)) { // Look for comments only if not in a generator
        if (charCode === 0x2F) { // '/'
          if (source[i + 1] === '*') {
            // Handle multiline comment
            if (options.commentTypes === 'all' || options.commentTypes === 'multiline') {
              if (inMultilineComment) {
                i = findMultilineCommentEnd(source, i) - 1;
              } else {
                if (i + 2 < source.length && source[i + 2] !== '#') { // Check for '*/'
                  inMultilineComment = true;
                  commentStart = i;
                }
              }
            }
            i++;
          } else if (source[i + 1] === '/' && (options.commentTypes === 'all' || options.commentTypes === 'singleline')) {
            // Handle single-line comment
            let j = i + 2;
            while (j < source.length && !isLineBreak(source.charCodeAt(j))) {
              j++;
            }
            // Add comment without checking for duplicates
            comments.push({ start: i, end: j, lines: [currentLine, ...], type: 'singleline' });
            i = j - 1;
          }
        } else if (charCode === 0x2A && source[i + 1] === '/' && !(commentState & (CommentStates.Multiline | CommentStates.Html)) && (options.commentTypes === 'all' || options.commentTypes === 'jsdoc')) {
          // Handle JSDoc comment
          commentState |= CommentStates.JsDoc;
          commentStart = i - 1;
          i++;
          // Add comment without checking for duplicates
          comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'jsdoc' });
        }
      }
    } else if (
      charCode === 0x43 &&
      source[i + 1] === 0x6C &&
      source[i + 2] === 0x61 &&
      source[i + 3] === 0x73 &&
      source[i + 4] === 0x73 &&
      !(
        commentState &
        (CommentStates.String |
          CommentStates.TemplateLiteral |
          CommentStates.Multiline |
          CommentStates.Html |
          CommentStates.RegExp |
          CommentStates.JsxExpression |
          CommentStates.ArrayLiteral)
      )
    ) {
      commentState |= CommentStates.ClassDeclaration;
      i += 4;
    } else if (commentState & CommentStates.ClassDeclaration && charCode === 0x7B) {
      commentState |= CommentStates.InClassDeclaration;
      i += 1;
    } else if (commentState & CommentStates.InClassDeclaration && charCode === 0x7D) {
      commentState &= ~CommentStates.InClassDeclaration;
      commentState &= ~CommentStates.ClassDeclaration;
      commentState &= ~CommentStates.GeneratorState;
    }

    // Handle regular expressions
    if (
      charCode === 0x2F &&
      !(
        commentState &
        (CommentStates.String |
          CommentStates.TemplateLiteral |
          CommentStates.Multiline |
          CommentStates.Html)
      )
    ) {
      if (commentState & CommentStates.RegExp) {
        if (source[i + 1] === 0x2F) {
          if (
            i + 2 < source.length &&
            !['i', 'm', 's', 'u', 'y', 'g'].includes(source[i + 2])
          ) {
            commentState &= ~CommentStates.RegExp;
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
        }
      }
    }

    if (commentState & CommentStates.RegExp) {
      // If inside a regular expression, collect comments as usual.
      // The comment extractor is still inside a regular expression. 
      // Handle comments within a regular expression
      if (charCode === 0x2F) { // '/'
        if (source[i + 1] === '*') {
          // Handle multiline comment
          if (options.commentTypes === 'all' || options.commentTypes === 'multiline') {
            if (inMultilineComment) {
              i = findMultilineCommentEnd(source, i) - 1;
            } else {
              if (i + 2 < source.length && source[i + 2] !== '#') { // Check for '*/'
                inMultilineComment = true;
                commentStart = i;
              }
            }
          }
          i++;
        } else if (source[i + 1] === '/' && (options.commentTypes === 'all' || options.commentTypes === 'singleline')) {
          // Handle single-line comment
          let j = i + 2;
          while (j < source.length && !isLineBreak(source.charCodeAt(j))) {
            j++;
          }
          // Add comment without checking for duplicates
          comments.push({ start: i, end: j, lines: [currentLine, ...], type: 'singleline' });
          i = j - 1;
        }
      } else if (charCode === 0x2A && source[i + 1] === '/' && !(commentState & (CommentStates.Multiline | CommentStates.Html)) && (options.commentTypes === 'all' || options.commentTypes === 'jsdoc')) {
        // Handle JSDoc comment
        commentState |= CommentStates.JsDoc;
        commentStart = i - 1;
        i++;
        // Add comment without checking for duplicates
        comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'jsdoc' });
      }
      continue;
    } 

    // Handle multiline comments
    if (charCode === 0x2F && source[i + 1] === '*') {
      if (commentState & CommentStates.Multiline) {
        i = findMultilineCommentEnd(source, i) - 1;
      } else if (options.commentTypes === 'all' || options.commentTypes === 'multiline') {
        if (i + 2 < source.length && source[i + 2] !== '#') { // Check for '*/'
          inMultilineComment = true;
          commentStart = i;
        }
      }
      i++;
    } else if (inMultilineComment) {
      if (charCode === 0x2A && source[i + 1] === 0x2F) {
        inMultilineComment = false;
        // Add comment without checking for duplicates
        comments.push({ start: commentStart, end: i + 2, lines: [currentLine, ...], type: 'multiline' });
        i++;
      }
    } else if (
      charCode === 0x3C &&
      source[i + 1] === '!' &&
      source[i + 2] === '-' &&
      source[i + 3] === '-'
    ) {
      // Handle HTML comments (similar logic for duplicate check)
      if (options.commentTypes === 'all' || options.commentTypes === 'html') {
        commentState |= CommentStates.Html;
        commentStart = i;
      }
      i += 3;
      // Add comment without checking for duplicates
      comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'html' });
    } else if (commentState & CommentStates.Html) {
      if (source[i] === '-' && source[i + 1] === '-' && source[i + 2] === '>') {
        commentState &= ~CommentStates.Html;
        // Add comment without checking for duplicates
        comments.push({ start: commentStart, end: i + 3, lines: [currentLine, ...], type: 'html' });
        i += 2;
      }
    } else if (
      charCode === 0x2A &&
      source[i + 1] === '/' &&
      !(commentState & (CommentStates.Multiline | CommentStates.Html))
    ) {
      // Handle JSDoc comments (similar logic for duplicate check)
      if (options.commentTypes === 'all' || options.commentTypes === 'jsdoc') {
        commentState |= CommentStates.JsDoc;
        commentStart = i - 1;
      }
      i++;
      // Add comment without checking for duplicates
      comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'jsdoc' });
    } else if (commentState & CommentStates.JsDoc && isLineBreak(charCode)) {
      commentState &= ~CommentStates.JsDoc;
      // Add comment without checking for duplicates
      comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'jsdoc' });
    } else if (commentState & CommentStates.JsDoc) {
      if (isLineBreak(charCode)) {
        currentLine++;
      } else {
        i++;
      }
    } else if (
      charCode === 0x2F &&
      source[i + 1] === '/' &&
      !(commentState & (CommentStates.Multiline | CommentStates.Html | CommentStates.JsDoc))
    ) {
      // Handle single-line comments (similar logic for duplicate check)
      if (options.commentTypes === 'all' || options.commentTypes === 'singleline') {
        let j = i + 2;
        while (j < source.length && !isLineBreak(source.charCodeAt(j))) {
          j++;
        }
        // Add comment without checking for duplicates
        comments.push({ start: i, end: j, lines: [currentLine, ...], type: 'singleline' });
        i = j - 1;
      }
    } else if (isLineBreak(charCode)) {
      currentLine++;
    } else {
      // Handle punctuators here (use lookup table for faster access)
      punctuatorState |= punctuatorLookup.get(charCode) || 0; 

      // Check for comment start markers after punctuators
      if (charCode === 0x2F && source[i + 1] === '/') {
        // Handle single-line comments (similar logic for duplicate check)
        if (options.commentTypes === 'all' || options.commentTypes === 'singleline') {
          let j = i + 2;
          while (j < source.length && !isLineBreak(source.charCodeAt(j))) {
            j++;
          }
          // Add comment without checking for duplicates
          comments.push({ start: i, end: j, lines: [currentLine, ...], type: 'singleline' });
          i = j - 1;
        }
      } else if (charCode === 0x2A && source[i + 1] === '/' && !(commentState & (CommentStates.Multiline | CommentStates.Html))) {
        // Handle JSDoc comments (similar logic for duplicate check)
        if (options.commentTypes === 'all' || options.commentTypes === 'jsdoc') {
          commentState |= CommentStates.JsDoc;
          commentStart = i - 1;
        }
        i++;
        // Add comment without checking for duplicates
        comments.push({ start: commentStart, end: i, lines: [currentLine, ...], type: 'jsdoc' });
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

    if (commentState & CommentStates.Multiline && commentStart >= 0) {
      // Add comment without checking for duplicates
      comments.push({ start: commentStart, end: source.length, lines: [currentLine, ...], type: 'multiline' });
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
