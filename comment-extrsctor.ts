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
  lines: number[];
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
  let currentLine = 0;
  let inMultilineComment = false;
  let nestingLevel = 0;
  let inJsxAttribute = false;

  // Handle comments at the beginning of the code
  if (previousTokenEnd === 0) {
    for (let i = 0; i < source.length; i++) {
      if (source[i] === '/' && (source[i + 1] === '*' || source[i + 1] === '/')) {
        commentState = source[i + 1] === '*' ? CommentStates.Multiline : CommentStates.None;
        commentStart = i;
        i += commentState === CommentStates.Multiline ? 2 : 1;
        break;
      } else if (source[i] === '#' && source[i + 1] === '!') { // Handle hashbang comments at the beginning
        commentState = CommentStates.None; // Hashbang comments don't affect other states
        commentStart = i;
        let j = i + 2;
        while (j < source.length && (source.charCodeAt(j) !== lineBreakLookup[0] && source.charCodeAt(j) !== lineBreakLookup[1])) {
          j++;
        }
        comments.push({
          start: i,
          end: j,
          lines: [currentLine],
          type: 'hashbang',
          nested: false,
        });
        i = j - 1;
        break; // Stop processing after hashbang comment
      }
    }

    if (commentState & CommentStates.Multiline && commentStart >= 0) {
      // Track lines for multi-line comments at the beginning
      const lines: number[] = [currentLine];
      for (let k = commentStart; k < source.length && !(source[k] === '*' && source[k + 1] === '/'); k++) {
        if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) { 
          lines.push(++currentLine);
        }
        if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
          k++; // Skip LF after CR
        }
      }

      // Check if the comment is terminated before the end of the code
      let endIndex = source.length;
      if (source[k] === '*' && source[k + 1] === '/') {
        endIndex = k + 2;
        inMultilineComment = false;
        nestingLevel = 0;
      }

      comments.push({
        start: commentStart,
        end: endIndex,
        lines: lines,
        type: 'multiline',
        nested: false,
      });
    }
  }

  let quoteChar = null;
  let j = 0;
  let isEscaped = false;
  let inEscapeSequence = false;

  // Main loop to process the code
  for (let i = previousTokenEnd; i < nextTokenStart; i++) {
    const charCode = source.charCodeAt(i);

    // Handle escaped characters within strings and template literals
    if ((commentState & (CommentStates.String | CommentStates.TemplateLiteral)) && charCode === 0x5C) {
      isEscaped = !isEscaped;
      inEscapeSequence = true;
      continue; 
    }
    // Reset isEscaped if not part of an escape sequence
    if (!inEscapeSequence) {
      isEscaped = false;
    }

    // Handle escaped newline within template literals
    if ((commentState & CommentStates.TemplateLiteral) && isEscaped && source[i] === 'n') {
      currentLine++;
    }

    // Handle JSX fragments
    if (
      charCode === 0x3C && // '<'
      source[i + 1] === 0x2F && // '/'
      !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp | CommentStates.JsxExpression))
    ) {
      commentState |= CommentStates.JsxFragment;
      commentStart = i;
      i++;
    } else if (commentState & CommentStates.JsxFragment && charCode === 0x3E) { // '>'
      commentState &= ~CommentStates.JsxFragment;
      if (commentStart >= 0) {
        const commentBefore = collectComments(source, commentStart, i, options);
        if (commentBefore.length) {
          // Set nested flag correctly for comments within JSX fragments
          commentBefore.forEach(comment => {
            comment.nested = nestingLevel > 0;
          });
          comments.push(...commentBefore);
        }
      }
      commentStart = i; // Capture the end position for potential comment after the closing bracket
    } else if (commentState & CommentStates.JsxFragment) {
      commentStart = i; // Capture the start position for potential comment before the closing bracket

      // Track lines within JSX fragments
      if (charCode === 0x0A) { // Line Feed
        currentLine++;
      }
    }

    // Handle array literals (using bitmask for conditions)
    const notInStringTemplateMultilineHtmlRegExpOrJsxExpression = !(commentState & (CommentStates.String | CommentStates.TemplateLiteral | CommentStates.Multiline | CommentStates.Html | CommentStates.RegExp | CommentStates.JsxExpression));
    if (
      charCode === 0x5B && // '['
      notInStringTemplateMultilineHtmlRegExpOrJsxExpression 
    ) {
      commentState |= CommentStates.ArrayLiteral;
    } else if (charCode === 0x5D && (commentState & CommentStates.ArrayLiteral)) { // ']'
      commentState &= ~CommentStates.ArrayLiteral;
    }

    // Handle class declarations and generators
    if (commentState & CommentStates.InClassDeclaration) {
      if (charCode === 0x2A && source[i + 1] === 0x28) { // '*' followed by '('
        commentState |= CommentStates.GeneratorState;
        i++;
      } else if (charCode === 0x2A && source[i + 1] === 0x2F && !(commentState & CommentStates.Multiline)) {
        // '*/' not ending multiline
        // Skip '*/'
        i++;
      } else if (!(commentState & CommentStates.GeneratorState)) {
        // Look for comments only if not in a generator
        if (charCode === 0x2F) { // '/'
          if (source[i + 1] === '*') {
            // Handle multiline comment
            if (options.commentTypes === 'all' || options.commentTypes === 'multiline') {
              if (inMultilineComment) {
                nestingLevel++;
              } else {
                if (i + 2 < source.length && source[i + 2] !== '#') { // Check for '*/'
                  inMultilineComment = true;
                  commentStart = i;
                  nestingLevel = 1; // Initialize nesting level

                  // Inline findMultilineCommentEnd (unroll first few iterations)
                  for (j = i + 1; j < source.length; j++) {
                    if (source[j] === '*' && source[j + 1] === '/') {
                      i = j;
                      break;
                    } 
                  }

                  // Track lines for multi-line comments
                  const lines: number[] = [currentLine];
                  for (let k = commentStart; k <= i + 1; k++) {
                    if (source.charCodeAt(k) === 0x0A || (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) !== 0x0A)) { 
                      lines.push(++currentLine);
                    }
                    if (source.charCodeAt(k) === 0x0D && source.charCodeAt(k + 1) === 0x0A) { // Handle CRLF
                      k++; // Skip LF after CR
                    }
                  }

                  comments.push({
                    start: commentStart,
                    end: i + 2,
                    lines: lines,
                    type: 'multiline',
                    nested: nestingLevel > 1,
                  });
                }
              }
            }
            i++;
          } else if (source[i + 1] === '/' && (options.commentTypes === 'all' || options.commentTypes === 'singleline')) {
            // Handle single-line comment
            let j = i + 2;
            while (j < source.length && (source.charCodeAt(j) !== lineBreakLookup[0] && source.charCodeAt(j) !== lineBreakLookup[1])) { 
              j++;
            }
            comments.push({
              start: i,
              end: j,
              lines: [currentLine],
              type: 'singleline',
              nested: nestingLevel > 0,
            });
            i = j - 1;
          }
        } else if (
          charCode === 0x2A && // '*'
          source[i + 1] === '/' && // '/'
          !(commentState & (CommentStates.Multiline | CommentStates.Html)) &&
          (options.commentTypes === 'all' || options.commentTypes === 'jsdoc')
        ) {
          // Handle JSDoc comment
          commentState |= CommentStates.JsDoc;
          commentStart = i - 1;
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

          comments.push({
            start: commentStart,
            end: i,
            lines: lines,
            type: 'jsdoc',
            nested: nestingLevel > 0,
          });
        }
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

        comments.push({
          start: commentStart,
          end: i,
          lines: lines,
          type: 'jsdoc',
          nested: nestingLevel > 0,
        });
      } else if (commentState & CommentStates.JsDoc) {
        if (charCode === lineBreakLookup[0] || charCode === lineBreakLookup[1]) {
          currentLine++;
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

                comments.push({
                    start: i,
                    end: j,
                    lines: [currentLine],
                    type: 'singleline',
                    nested: false,
                });

                i = j - 1;
            }
        } else if (charCode === 0x23 && source[i + 1] === 0x21 && i === 0) { // Hashbang comment
            if (options.commentTypes === 'all' || options.commentTypes.includes('singleline')) {
                let j = i + 2;
                while (j < source.length && (source.charCodeAt(j) !== lineBreakLookup[0] && source.charCodeAt(j) !== lineBreakLookup[1])) {
                    j++;
                }
                comments.push({
                    start: i,
                    end: j,
                    lines: [currentLine],
                    type: 'hashbang',
                    nested: false,
                });
                i = j - 1;
            }
        } else if (charCode === lineBreakLookup[0] || charCode === lineBreakLookup[1]) {
            currentLine++;

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

                    comments.push({
                        start: i,
                        end: j,
                        lines: [currentLine],
                        type: 'singleline',
                        nested: false,
                    });

                    i = j - 1;
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

                comments.push({
                    start: commentStart,
                    end: i,
                    lines: lines,
                    type: 'jsdoc',
                    nested: nestingLevel > 0,
                });
            }

            // Reset isEscaped and inEscapeSequence after handling any character within a string or template literal
            if (commentState & (CommentStates.String | CommentStates.TemplateLiteral)) {
                isEscaped = false;
                inEscapeSequence = false;
            }
        }
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
                lines,
                type: 'html',
                nested: nestingLevel > 0,
            });
        } else if (commentState & CommentStates.String && quoteChar && commentStart >= 0) {
            // Handle unterminated strings
            comments.push({
                start: commentStart,
                end: source.length,
                lines: [currentLine], 
                type: 'unterminatedString',
                nested: false,
            });
        } else if (commentState & CommentStates.RegExp && commentStart >= 0) {
            // Handle unterminated regular expressions
            comments.push({
                start: commentStart,
                end: source.length,
                lines: [currentLine],
                type: 'unterminatedRegExp',
                nested: false,
            });
        } else if ((commentState & CommentStates.TemplateLiteral) && commentStart >= 0) {
          // Handle unterminated template literals
          comments.push({
            start: commentStart, 
            end: source.length,
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

