// Inject an epub file into the hidden import input and fire change.
// Usage: agent-browser eval --stdin < this file  (with URL substituted)
const url = '__FIXTURE_URL__';
const name = '__FILE_NAME__';
const res = await fetch(url);
const blob = await res.blob();
const file = new File([blob], name, { type: 'application/epub+zip' });
const dt = new DataTransfer();
dt.items.add(file);
const input = document.querySelector('input[type=file]');
input.files = dt.files;
input.dispatchEvent(new Event('change', { bubbles: true }));
'dispatched ' + file.name + ' (' + file.size + ' bytes)';
