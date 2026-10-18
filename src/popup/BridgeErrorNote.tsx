import { CodeLine, Note } from '../options/controls';
import { AlertIcon } from './icons';

export function BridgeErrorNote({ message }: { message: string }) {
  return (
    <Note tone="error">
      <p class="nhead">
        <AlertIcon />
        <span>{message}</span>
      </p>
      <p>Install it from the LocalPolish folder:</p>
      <CodeLine text="npm run bridge:install" />
    </Note>
  );
}
