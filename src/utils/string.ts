/**
 * Formats multiline strings by trimming each line and removing extra whitespace
 * @param {string} text The multiline text to format
 * @returns {string} The formatted text with proper spacing
 */
export const trimLines = (text: string): string =>
    text
        .split('\n')
        .map((line) => line.trim())
        .filter(
            (line, index, array) =>
                // Keep non-empty lines
                line.length > 0 ||
                // Also keep empty lines that are between content (not first or last)
                (index > 0 &&
                    index < array.length - 1 &&
                    array[index - 1].trim().length > 0 &&
                    array[index + 1].trim().length > 0),
        )
        .join('\n');
