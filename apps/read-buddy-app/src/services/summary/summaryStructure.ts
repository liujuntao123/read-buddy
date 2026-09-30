/**
 * Strips raw horizontal rules (---, ***, ___) from parsed section markdown.
 */
function cleanSectionLines(lines: string[]): string {
  const filtered = lines.filter((l) => !/^\s*[-*_]{3,}\s*$/.test(l));
  return filtered.join('\n').trim();
}

/**
 * Parses markdown into three-part sections if headings are present.
 */
export interface SummarySection {
  id: string;
  heading: string;
  content: string;
}

export function parseSummarySections(markdown: string): {
  preface?: string;
  sections: SummarySection[];
} {
  if (!markdown) {
    return { sections: [] };
  }
  const lines = markdown.split(/\r?\n/);
  const sections: SummarySection[] = [];
  let currentHeading = '';
  let currentLines: string[] = [];
  let prefaceLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^#{2,4}\s+(.+)$/);
    if (match) {
      if (!currentHeading) {
        prefaceLines = currentLines;
      } else {
        sections.push({
          id: `section-${sections.length}`,
          heading: currentHeading,
          content: cleanSectionLines(currentLines),
        });
      }
      currentHeading = match[1].trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentHeading) {
    sections.push({
      id: `section-${sections.length}`,
      heading: currentHeading,
      content: cleanSectionLines(currentLines),
    });
  } else {
    prefaceLines = currentLines;
  }

  const preface = cleanSectionLines(prefaceLines);
  return { preface: preface || undefined, sections };
}


