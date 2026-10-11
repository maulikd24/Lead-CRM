/**
 * Runs before first paint (inline, in the page body) so the right theme is on <html> with no flash. The saved choice wins; with
 * none, the system preference decides on the first visit (light when there is no preference). Storage may be blocked: every
 * access is inside try/catch and the page still works. No external request.
 */
export const THEME_KEY = "fd-theme";

const SCRIPT = `(function(){var d=document.documentElement,t=null;try{t=localStorage.getItem("${THEME_KEY}")}catch(e){}if(t!=="light"&&t!=="dark"){try{t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}catch(e){t="light"}}d.setAttribute("data-fd-theme",t)})()`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
