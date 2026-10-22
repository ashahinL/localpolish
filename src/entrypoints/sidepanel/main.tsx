import { render } from 'preact';
import { App } from '../../chat/App';
import '../../options/tokens.css';
import '../../chat/chat.css';

render(<App />, document.getElementById('app')!);
