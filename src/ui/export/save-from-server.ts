/** Browser download of a server-held file, without pulling it through the page. */

/** Hand a server file to the browser's download: an attached link, clicked, with ?download. */
export function saveFromServer(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = `${url}${url.includes('?') ? '&' : '?'}download=1`;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}
