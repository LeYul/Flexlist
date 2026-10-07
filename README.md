# Flexlist

Application privée pour choisir des films et séries, les mettre en favoris et les faire télécharger automatiquement par le NAS (Radarr pour les films, Sonarr pour les séries), qui les range ensuite dans `NETFLEX`.

Elle fonctionne dans un navigateur et s'installe comme une application sur téléphone, tablette et ordinateur (PWA, sans passer par un store).

---

## 1. Installation sur le NAS (environ 5 minutes)

Les fichiers sont déjà déposés dans `\\NAS-Yul\Docker\Flexlist\` :

```
Flexlist\
├── app\                  ← le code de l'application (ne pas modifier)
├── data\                 ← base de données de l'application (favoris, catalogue, réglages)
└── docker-compose.yml    ← la « stack » à donner à Portainer
```

1. Ouvrir Portainer : <http://192.168.1.54:19900>.
2. **Stacks › Add stack**, nom : `flexlist`.
3. **Web editor** : coller le contenu de `docker-compose.yml`, puis **Deploy the stack**.
4. Ouvrir <http://192.168.1.54:18787>.

> L'image utilisée est l'image officielle `node:24-alpine` : rien à compiler. Si Portainer signale une architecture non prise en charge, remplacer `node:24-alpine` par `node:24-slim`.
>
> Si la vidéothèque n'est pas trouvée (message dans **Réglages › Vidéothèque**), vérifier le chemin de la ligne `/volume1/home/Yul/NETFLEX:/netflex:ro` dans la stack (c'est le dossier `NETFLEX` vu depuis le NAS).

## 2. Connecter Radarr et Sonarr (une seule fois)

Dans l'application : **Réglages › Connexion au NAS**.

| Service | Adresse | Où trouver la clé API |
|---|---|---|
| Radarr (films) | `http://192.168.1.54:17878` | Radarr › Settings › General › Security › API Key |
| Sonarr (séries) | `http://192.168.1.54:18989` | Sonarr › Settings › General › Security › API Key |

Coller la clé, cliquer **Tester la connexion**, puis **Enregistrer**. Le dossier de destination est choisi automatiquement (`NETFLEX/Films` et `NETFLEX/Séries`) ; il peut être changé dans la liste déroulante.

Tant que ce n'est pas fait, les favoris sont bien enregistrés (« En attente d'envoi ») et partent automatiquement dès la connexion.

## 3. Installer l'application sur les appareils

- **iPhone / iPad** : ouvrir l'adresse dans Safari › bouton Partager › « Sur l'écran d'accueil ».
- **Android** : Chrome › menu ⋮ › « Ajouter à l'écran d'accueil » (ou « Installer l'application »).
- **Ordinateur** : Chrome ou Edge › icône d'installation dans la barre d'adresse.

Pour l'installation « complète » sur Android et ordinateur (fenêtre dédiée, mode hors connexion), les navigateurs exigent une adresse **HTTPS**. Deux solutions possibles, à faire plus tard si besoin :
- un proxy inverse avec certificat (proxy inverse d'ADM si votre version le propose, ou *Nginx Proxy Manager* installé via Portainer) ;
- **Tailscale** (recommandé pour un accès privé depuis l'extérieur) : `tailscale serve` fournit automatiquement une adresse HTTPS privée.

---

## Utilisation

| Écran | Rôle |
|---|---|
| **Découvrir** | Films et séries populaires **absents de NETFLEX** : tendances, séries du moment, « Pour vous » (d'après vos films), grands classiques, genres favoris. |
| **Swipe** | Une affiche à la fois : glisser à droite = favori, à gauche = pas intéressé, vers le haut = plus tard. Bouton ↺ pour annuler. Au clavier : ← → ↑. |
| **Rechercher** | N'importe quel film ou série (titre français ou original), avec indication de ce qui est déjà sur le NAS. |
| **Favoris** | Chaque demande avec son état : en attente, recherche, introuvable, téléchargement (en %), disponible. |
| **NETFLEX** | La liste complète des films et séries du NAS (affiches, filtres, tri), plus un onglet Favoris. |
| **Réglages** | Connexions, préférences par défaut, fréquences automatiques, mot de passe, installation. |

**À chaque mise en favori**, l'application demande les préférences : langue (VF, MULTi VF+VO, VOSTFR, VO, peu importe), qualité (équilibré 720p–1080p, 1080p, 4K, 720p, peu importe), saisons pour les séries, et une note libre.

**Titres introuvables** : si aucune version ne correspond aux critères, le favori passe en « Introuvable pour l'instant » et la recherche est **relancée automatiquement** (toutes les 6 h par défaut, réglable). Dès que le fichier arrive dans `NETFLEX`, le favori est **coché « Disponible »**.

## Fonctionnement technique

- Serveur Node.js sans dépendance externe (`server/`), interface web sans compilation (`public/`).
- Vidéothèque lue **en lecture seule** (montage `:ro`) toutes les 30 min. Rien n'est jamais supprimé, ni sur le NAS, ni dans Radarr/Sonarr (retirer un favori arrête seulement sa surveillance).
- Données :
  - films : base de métadonnées publique de Radarr (TMDb/IMDb, titres et résumés en français), mise à jour toutes les 12 h ;
  - séries : TVmaze (popularité, programmes des 7 derniers jours, titres français), mise à jour quotidienne et index complet hebdomadaire.
- Les préférences sont traduites en profils Radarr/Sonarr nommés `Flexlist · <langue> · <qualité>` (créés à la demande, avec trois formats personnalisés `Flexlist · VF / MULTi / VOSTFR` qui reconnaissent les noms de sorties). Les profils existants ne sont pas modifiés.
- Les éléments ajoutés portent l'étiquette `flexlist` dans Radarr/Sonarr.

## Lancer en local (test sur un PC)

```powershell
$env:LIBRARY_PATH='\\NAS-Yul\Home\NETFLEX'; node server/index.js
# puis http://localhost:8787
```
Variables utiles : `PORT`, `DATA_DIR`, `LIBRARY_PATH`, `RADARR_URL`, `RADARR_API_KEY`, `SONARR_URL`, `SONARR_API_KEY`, `APP_PASSWORD`.
