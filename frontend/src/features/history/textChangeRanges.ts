export interface TextChangeRange {
  /** UTF-16 offsets, so ranges can be sliced across existing rich-text runs. */
  start: number;
  end: number;
}

interface Token extends TextChangeRange { text: string }

function tokenize(text: string): Token[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}\p{M}_]+|\s+|[^\p{L}\p{N}\p{M}_\s]/gu), match => ({
    text: match[0], start: match.index!, end: match.index! + match[0].length,
  }));
}

function append(ranges: TextChangeRange[], token: TextChangeRange): void {
  const previous = ranges.at(-1);
  if (previous?.end === token.start) previous.end = token.end;
  else ranges.push({ start: token.start, end: token.end });
}

/** Word-level comparison with bounded alignment memory and exact source offsets. */
export function textChangeRanges(before: string, after: string): {
  before: TextChangeRange[];
  after: TextChangeRange[];
} {
  const result = { before: [] as TextChangeRange[], after: [] as TextChangeRange[] };
  if (before === after) return result;
  const left = tokenize(before);
  const right = tokenize(after);
  let start = 0;
  while (start < left.length && start < right.length && left[start].text === right[start].text) start++;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1].text === right[rightEnd - 1].text) {
    leftEnd--;
    rightEnd--;
  }
  const leftCount = leftEnd - start;
  const rightCount = rightEnd - start;
  // Large unrelated passages use a coarse replacement instead of quadratic work.
  // Common boundaries remain visible; source text and its formatting are untouched.
  if (!leftCount || !rightCount || (leftCount + 1) * (rightCount + 1) > 250_000) {
    if (leftCount) result.before.push({ start: left[start].start, end: left[leftEnd - 1].end });
    if (rightCount) result.after.push({ start: right[start].start, end: right[rightEnd - 1].end });
    return result;
  }

  const width = rightCount + 1;
  const scores = new Uint32Array((leftCount + 1) * width);
  for (let i = leftCount - 1; i >= 0; i--) {
    for (let j = rightCount - 1; j >= 0; j--) {
      scores[i * width + j] = left[start + i].text === right[start + j].text
        ? scores[(i + 1) * width + j + 1] + 1
        : Math.max(scores[(i + 1) * width + j], scores[i * width + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < leftCount || j < rightCount) {
    if (i < leftCount && j < rightCount && left[start + i].text === right[start + j].text) {
      i++;
      j++;
    } else if (i < leftCount && (j === rightCount || scores[(i + 1) * width + j] >= scores[i * width + j + 1])) {
      append(result.before, left[start + i++]);
    } else {
      append(result.after, right[start + j++]);
    }
  }
  return result;
}
