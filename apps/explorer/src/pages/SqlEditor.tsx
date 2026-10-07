import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";

const extensions = [sqlLang(), EditorView.contentAttributes.of({ "aria-label": "SQL" })];

export default function SqlEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <CodeMirror
      value={value}
      height="220px"
      theme="light"
      extensions={extensions}
      basicSetup={{ lineNumbers: true }}
      onChange={onChange}
    />
  );
}
