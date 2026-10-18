import { render } from 'preact';
import { App } from '../../popup/App';
import '../../options/tokens.css';
import '../../popup/popup.css';

render(<App />, document.getElementById('app')!);
