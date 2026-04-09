import { EditorApp } from './editor/app';

const app = new EditorApp(document.getElementById('app')!);
app.init().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Failed to initialize editor:', err);
});
