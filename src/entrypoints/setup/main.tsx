import { render } from 'preact';
import { App } from '../../setup/App';
import '../../options/tokens.css';
import '../../popup/popup.css';
import '../../setup/setup.css';

render(<App />, document.getElementById('app')!);
