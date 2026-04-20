import type { Plugin } from 'vite';

export interface ExternalScript {
  src:   string;
  type?: string;
  async?: boolean;
}

export interface HtmlConfig {
  title:           string;
  entry:           string;
  appMountId:      string;
  externalScripts: ExternalScript[];
}

function buildHtml(cfg: HtmlConfig): string {
  const scripts = cfg.externalScripts.map(s => {
    const attrs = [
      s.type  ? `type="${s.type}"` : '',
      s.async ? 'async'            : '',
      `src="${s.src}"`,
    ].filter(Boolean).join(' ');
    return `  <script ${attrs}></script>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${cfg.title}</title>
</head>
<body>
  <div id="${cfg.appMountId}"></div>
${scripts}
  <script type="module" src="/${cfg.entry}"></script>
</body>
</html>`;
}

export function generateHtmlPlugin(cfg: HtmlConfig): Plugin {
  return {
    name: 'generate-html',
    transformIndexHtml: {
      order: 'pre',
      handler: () => buildHtml(cfg),
    },
  };
}
