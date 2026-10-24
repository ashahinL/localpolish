import { useMemo } from 'preact/hooks';
import { parseMarkdown, type Block, type Inline } from './markdown';

// Recursion here follows the parsed tree, whose depth the parser caps.
function InlineNodes({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        switch (node.type) {
          case 'text':
            return node.text;
          case 'break':
            return <br key={index} />;
          case 'code':
            return <code key={index}>{node.text}</code>;
          case 'strong':
            return (
              <strong key={index}>
                <InlineNodes nodes={node.children} />
              </strong>
            );
          case 'em':
            return (
              <em key={index}>
                <InlineNodes nodes={node.children} />
              </em>
            );
          case 'link':
            return (
              <a key={index} href={node.href} target="_blank" rel="noopener noreferrer">
                <InlineNodes nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return (
              <p key={index} dir="auto">
                <InlineNodes nodes={block.children} />
              </p>
            );
          case 'heading':
            return (
              <p key={index} class="md-heading" dir="auto">
                <InlineNodes nodes={block.children} />
              </p>
            );
          case 'code':
            return (
              <pre key={index}>
                <code>{block.text}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={index} dir="auto">
                <Blocks blocks={block.children} />
              </blockquote>
            );
          case 'list': {
            const items = block.items.map((item, at) => (
              <li key={at}>
                <InlineNodes nodes={item} />
              </li>
            ));
            return block.ordered ? (
              <ol key={index} start={block.start} dir="auto">
                {items}
              </ol>
            ) : (
              <ul key={index} dir="auto">
                {items}
              </ul>
            );
          }
        }
      })}
    </>
  );
}

export function MarkdownView({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div class="md">
      <Blocks blocks={blocks} />
    </div>
  );
}
