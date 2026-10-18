import { render } from 'preact';
import { App } from '../../options/App';
import '../../options/tokens.css';
import '../../options/options.css';

render(<App />, document.getElementById('app')!);
