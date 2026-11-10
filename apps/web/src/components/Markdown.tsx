import { useContext } from 'react'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { MarkdownProjectContext } from '../markdownContext'

const schema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'details', 'summary', 'kbd', 'sub', 'sup', 'mark'],
  attributes: { ...defaultSchema.attributes, img: [...(defaultSchema.attributes?.img ?? []), 'width', 'height'] },
  protocols: { ...defaultSchema.protocols, href: [...(defaultSchema.protocols?.href ?? []), 'attachment'], src: [...(defaultSchema.protocols?.src ?? []), 'attachment'] },
}
const remarkPlugins = [remarkGfm]
const rehypePlugins = [rehypeRaw, [rehypeSanitize, schema]] as NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']>

export const Markdown = ({ text, projectId }: { text: string; projectId?: string }) => {
  const currentProject = useContext(MarkdownProjectContext)
  const id = projectId ?? currentProject
  return <div className="md rich-markdown"><ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins}
    urlTransform={(url) => {
      const attachment = /^attachment:([a-f0-9-]{36})$/.exec(url)
      return attachment && id ? `/api/projects/${encodeURIComponent(id)}/attachments/${attachment[1]}` : defaultUrlTransform(url)
    }} components={{
      a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
      img: ({ node: _node, ...props }) => <img {...props} loading="lazy" decoding="async" />,
      table: ({ node: _node, ...props }) => <div className="md-table-scroll"><table {...props} /></div>,
    }}>{text}</ReactMarkdown></div>
}
