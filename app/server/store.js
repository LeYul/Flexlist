// Persistance JSON simple (écriture atomique + sauvegarde différée).
import fs from 'node:fs';
import path from 'node:path';

export class JsonFile {
  constructor(dir, name, defaults) {
    this.file = path.join(dir, name);
    this.timer = null;
    this.data = structuredClone(defaults);
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      this.data = { ...this.data, ...JSON.parse(raw) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Fichier corrompu : on le met de côté au lieu de l'écraser.
        try { fs.renameSync(this.file, `${this.file}.corrompu-${Date.now()}`); } catch {}
      }
    }
  }

  save(delay = 800) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), delay);
  }

  saveNow() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
