/**
 * The <b> in a written line, actually bold.
 *
 * The changelog and the rules panel are both prose kept in a data file, and
 * both mark the part that matters with <b>. React escapes a string child, so
 * for a while those lines printed their own angle brackets on screen.
 *
 * Not dangerouslySetInnerHTML: the text is ours and safe today, but these are
 * exactly the files that one day get a line pasted into them from somewhere
 * else. One tag, parsed; anything else stays literal.
 */
export default function Rich({ text }: { text: string }) {
  const parts = text.split(/<b>|<\/b>/)
  return (
    <span>
      {parts.map((part, i) => (
        // splitting on a pair of delimiters puts the bold runs on odd indices
        i % 2 ? <b key={i}>{part}</b> : <span key={i}>{part}</span>
      ))}
    </span>
  )
}
