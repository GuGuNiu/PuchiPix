


const PUBLISHER_PREFIX_PATTERN = /^[\u4e00-\u9fff]{3,8}[:]\s*/;


export function removePublisherPrefix(title: string): string {
  if (!title) return '';
  return title.replace(PUBLISHER_PREFIX_PATTERN, '').trim();
}


export function cleanTitleBase(title: string): string {
  if (!title) return '';
  let result = title.trim();
  result = result.replace(/^\[[^\]]*\]\s*/, '');
  result = removePublisherPrefix(result);
  return result.trim();
}
