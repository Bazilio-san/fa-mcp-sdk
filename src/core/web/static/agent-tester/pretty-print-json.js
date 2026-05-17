// Browser port of docs/pretty-print-json.ts (extended `prettyPrintJson` —
// deserializes escape sequences, wraps long strings in a scrollable container).
// noinspection UnnecessaryLocalVariableJS

(function (root) {
  const prettyPrintJson = {
    toHtml(thing, options) {
      const settings = {
        indent: 3,
        lineNumbers: false,
        linkUrls: true,
        linksNewTab: true,
        quoteKeys: false,
        trailingComma: true,
        maxTextLength: 100,
        minTextContainerWidth: 300,
        ...options,
      };

      const htmlEntities = (text) => text.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));

      const deserializeString = (str) =>
        str
          .replace(/\\"/g, '"')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\b/g, '\b')
          .replace(/\\f/g, '\f')
          .replace(/\\v/g, '\v')
          .replace(/\\0/g, '\0')
          .replace(/\\'/g, "'")
          .replace(/\\\\/g, '\\');

      const spanTag = (type, display) => (display ? `<span class="json-${type}">${display}</span>` : '');

      const buildValueHtml = (value) => {
        const strType = value.startsWith('"') && 'string';
        const boolType = ['true', 'false'].includes(value) && 'boolean';
        const nullType = value === 'null' && 'null';
        const type = boolType || nullType || strType || 'number';

        if (strType) {
          const stringContent = value.slice(1, -1);
          if (stringContent.length > settings.maxTextLength) {
            const deserialized = deserializeString(stringContent);
            return `<span class="json-${type}"><span class="json-long-text-inline" style="--min-text-width: ${settings.minTextContainerWidth}px;"><div class="json-long-text-content">${htmlEntities(deserialized)}</div></span></span>`;
          }
        }

        const urlPattern = /https?:\/\/[^\s"]+?(?="|$)/g;
        const target = settings.linksNewTab ? ' target="_blank"' : '';
        const makeLink = (link) => `<a class="json-link" href="${link}"${target}>${link}</a>`;
        const display = strType && settings.linkUrls ? value.replace(urlPattern, makeLink) : value;
        return spanTag(type, display);
      };

      const replacer = (match, p1, p2, p3, p4) => {
        const part = { indent: p1, key: p2, value: p3, end: p4 };
        const findName = settings.quoteKeys ? /(.*)(): / : /"([\w$]+)": |(.*): /;
        const indentHtml = part.indent || '';
        const keyName = part.key && part.key.replace(findName, '$1$2');
        const keyHtml = part.key ? spanTag('key', keyName) + spanTag('mark', ': ') : '';
        const valueHtml = part.value ? buildValueHtml(part.value) : '';
        const lastChar = (match && match[match.length - 1]) || '';
        const noComma = !part.end || [']', '}'].includes(lastChar);
        const addComma = settings.trailingComma && match[0] === ' ' && noComma;
        const endHtml = spanTag('mark', addComma ? `${part.end || ''},` : part.end);

        const hasLongText = valueHtml.includes('json-long-text-inline');
        if (hasLongText && part.key) {
          return `${indentHtml}<span class="json-key-container">${keyHtml}</span>${valueHtml}${endHtml}`;
        }
        return indentHtml + keyHtml + valueHtml + endHtml;
      };

      const jsonLine = /^( *)("[^"]+": )?((?:"(?:[^"\\]|\\.)*")|[\w.+-]*)?([{}[\],]*)?$/gm;
      const json = JSON.stringify(thing, null, settings.indent) || 'undefined';
      const html = htmlEntities(json).replace(jsonLine, replacer);

      if (!settings.lineNumbers) {
        return html;
      }
      const makeLine = (line) => {
        const hasLongText = line.includes('json-long-text-inline');
        const cls = hasLongText ? ' class="json-line-with-long-text"' : '';
        return `   <li${cls}>${line}</li>`;
      };
      return ['<ol class="json-lines">', ...html.split('\n').map(makeLine), '</ol>'].join('\n');
    },
  };
  root.prettyPrintJson = prettyPrintJson;
})(window);
