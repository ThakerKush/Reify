// components/file-icon.tsx
import { FaReact } from "react-icons/fa";
import { SiTypescript, SiJavascript, SiPython } from "react-icons/si";
import { VscJson, VscFile } from "react-icons/vsc";

export function FileIcon({
  filename,
  className,
}: {
  filename: string;
  className?: string;
}) {
  const ext = filename.split(".").pop()?.toLowerCase() || "";

  // Map extensions to specific icons
  const iconMap: Record<string, React.ReactNode> = {
    tsx: <FaReact className={className} />,
    jsx: <FaReact className={className} />,
    ts: <SiTypescript className={className} />,
    js: <SiJavascript className={className} />,
    py: <SiPython className={className} />,
    json: <VscJson className={className} />,
  };

  // Return matched icon or default file icon
  return iconMap[ext] || <VscFile className={className} />;
}
