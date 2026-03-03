const URL_REGEX = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g;
const URL_TEST = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/;

export function linkify(text: string) {
  const parts = text.split(URL_REGEX);
  return parts.map((part, i) => {
    if (URL_TEST.test(part)) {
      const href = part.startsWith("http") ? part : `https://${part}`;
      return (
        <a
          key={i}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--primary)] underline break-all"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}
