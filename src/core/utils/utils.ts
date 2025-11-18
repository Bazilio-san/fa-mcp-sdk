export const trim = (s: any): string => String(s || '').trim();

export const ppj = (v: any) => {
  return JSON.stringify(v, null, 2);
};

export const isObject = (o: any): boolean => (o && typeof o === 'object');

export const isNonEmptyObject = (o: any): boolean => isObject(o) && !Array.isArray(o) && Object.values(o).some((v) => v !== undefined);

export const isMainModule = (url: string) => {
  const modulePath = (process.argv[1] || '').replace(/\\/g, '/');
  url = url.replace(/file:\/+/, '');
  return modulePath && (url === modulePath);
};

export const encodeSvgForDataUri = (svg: string): string => {
  // Encode SVG for use in data URI
  return encodeURIComponent(svg)
    .replace(/'/g, '%27')
    .replace(/"/g, '%22');
};
