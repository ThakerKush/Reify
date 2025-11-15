// components/mention-chip.tsx
import { FileIcon } from "./file-icon";

export function MentionChip({
  name,
  onRemove,
}: {
  name: string;
  onRemove: () => void;
}) {
  return (
    <div className="group inline-flex items-center gap-1.5 pl-2 pr-2.5 py-0.5 bg-blue-500/10 border border-blue-500/30 rounded text-xs">
      {/* Icon - visible by default, hidden on hover */}
      <FileIcon
        filename={name}
        className="w-3 h-3 shrink-0 group-hover:hidden"
      />

      {/* X button - hidden by default, visible on hover */}
      <button
        onClick={onRemove}
        className="hidden group-hover:block w-3 h-3 shrink-0 text-blue-600/60 hover:text-blue-600 cursor-pointer transition-colors"
      >
        ✕
      </button>

      {/* Filename */}
      <span className="text-blue-600 dark:text-blue-400 truncate">{name}</span>
    </div>
  );
}
