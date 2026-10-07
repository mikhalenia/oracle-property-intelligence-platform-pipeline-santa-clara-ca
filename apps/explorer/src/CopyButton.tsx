import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { IconButton, Tooltip } from "@mui/material";

export function CopyButton({ text }: { text: string }) {
  return (
    <Tooltip title="Copy">
      <IconButton
        size="small"
        aria-label={`copy ${text}`}
        onClick={() => void navigator.clipboard?.writeText(text)}
      >
        <ContentCopyIcon fontSize="inherit" />
      </IconButton>
    </Tooltip>
  );
}
