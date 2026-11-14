# Inlines img/ into one self-contained deck.html (for sharing as a single file).
import base64, pathlib, re
here = pathlib.Path(__file__).parent
html = (here / 'index.html').read_text()
def data(m):
    p = here / m.group(2)
    mime = 'image/png' if p.suffix == '.png' else 'image/jpeg'
    return m.group(1) + f'data:{mime};base64,' + base64.b64encode(p.read_bytes()).decode()
html = re.sub(r'(url\(|src="|data-bg=")(img/[\w.-]+)', data, html)
(here / 'deck.html').write_text(html)
print('wrote', here / 'deck.html', len(html) // 1024, 'KB')
