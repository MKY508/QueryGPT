<div align="center">
  
  <img src="../images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="README.md">English</a> •
    <a href="docs/README_CN.md">简体中文</a> •
    <a href="#">Français</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/badge/Stars-MKY508/QueryGPT-yellow.svg?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>Un Agent d'analyse de données intelligent basé sur OpenInterpreter</h3>
  <p><i>Dialoguez avec votre base de données en langage naturel</i></p>
  
</div>

## ✨ Avantages Principaux

**Pense comme un Analyste de Données**
- **Exploration Autonome** : Examine proactivement les structures de tables et les données d'échantillon lors de problèmes
- **Validation Multi-tours** : Vérifie à nouveau lorsque des anomalies sont trouvées pour garantir des résultats précis
- **Analyse Complexe** : Pas seulement SQL, peut exécuter Python pour l'analyse statistique et l'apprentissage automatique
- **Pensée Visible** : Affichage en temps réel du processus de raisonnement de l'Agent (Chain-of-Thought)

## 📸 Captures d'écran du Système

<img src="../images/agent-thinking-en.png" width="100%" alt="Interface QueryGPT"/>

**Affichage en temps réel du processus de pensée de l'IA, analyse complexe de données à travers des conversations en français.**

---

<img src="../images/data-visualization-en.png" width="100%" alt="Visualisation des Données"/>

**Génération automatique de graphiques interactifs, insights de données en un coup d'œil.**

---

<img src="../images/developer-view-en.png" width="100%" alt="Vue Développeur"/>

**Exécution de code entièrement transparente, supporte SQL et Python comme moteurs doubles.**

## 🌟 Fonctionnalités

### Capacités Principales de l'Agent
- **Exploration Autonome des Données** : L'Agent comprend proactivement la structure des données et explore les relations
- **Raisonnement Multi-tours** : Comme un analyste, enquête en profondeur lorsque des problèmes surviennent
- **Chain-of-Thought** : Affichage en temps réel du processus de pensée de l'Agent, intervention possible à tout moment
- **Mémoire Contextuelle** : Comprend l'historique des conversations, supporte l'analyse continue multi-tours

### Capacités d'Analyse de Données
- **SQL + Python** : Pas limité à SQL, peut exécuter un traitement complexe de données en Python
- **Analyse Statistique** : Analyse automatique de corrélation, prédiction de tendances, détection d'anomalies
- **Termes Métiers** : Compréhension native de concepts comme YoY, MoM, rétention, rachat
- **Visualisation Intelligente** : Sélectionne automatiquement le meilleur type de graphique basé sur les caractéristiques des données

### Caractéristiques du Système
- **Support Multi-modèles** : Changez librement entre GPT-5, Claude, Gemini, modèles locaux Ollama
- **Déploiement Flexible** : Supporte l'API cloud ou le déploiement local Ollama, les données ne quittent jamais les locaux
- **Enregistrements d'Historique** : Sauvegarde le processus d'analyse, supporte le suivi et le partage
- **Sécurité des Données** : Permissions en lecture seule, protection contre l'injection SQL, masquage des données sensibles
- **Export Flexible** : Supporte les formats Excel, PDF, HTML et autres

## 📦 Exigences Techniques

- Python 3.10.x (requis, dépendance d'OpenInterpreter 0.4.3)
- MySQL ou base de données compatible

> Windows : Exécutez dans WSL (n'exécutez pas les scripts dans PowerShell/CMD).

## 📊 Comparaison de Produits

| Dimension de Comparaison | **QueryGPT** | Vanna AI | DB-GPT | TableGPT | Text2SQL.AI |
|-------------------------|:------------:|:--------:|:------:|:--------:|:-----------:|
| **Coût** | **✅ Gratuit** | ⭕ Version payante | ✅ Gratuit | ❌ Payant | ❌ Payant |
| **Open Source** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Déploiement Local** | **✅** | ✅ | ✅ | ❌ | ❌ |
| **Exécute du Code Python** | **✅ Environnement complet** | ❌ | ❌ | ❌ | ❌ |
| **Capacité de Visualisation** | **✅ Programmable** | ⭕ Graphiques prédéfinis | ✅ Graphiques riches | ✅ Graphiques riches | ⭕ Basique |
| **Compréhension des Termes Métiers** | **✅ Native** | ⭕ Basique | ✅ Bon | ✅ Excellent | ⭕ Basique |
| **Exploration Autonome de l'Agent** | **✅** | ❌ | ⭕ Basique | ⭕ Basique | ❌ |
| **Affichage de Pensée en Temps Réel** | **✅** | ❌ | ❌ | ❌ | ❌ |
| **Capacité d'Extension** | **✅ Extension illimitée** | ❌ | ❌ | ❌ | ❌ |

### Nos Différences Principales
- **Environnement Python Complet** : Pas de fonctionnalités prédéfinies, mais un véritable environnement d'exécution Python où vous pouvez écrire n'importe quel code
- **Extensibilité Illimitée** : Besoin de nouvelles fonctionnalités ? Installez simplement de nouvelles bibliothèques, pas besoin d'attendre les mises à jour du produit
- **Exploration Autonome de l'Agent** : Enquête proactivement lorsqu'il rencontre des problèmes, pas seulement une simple requête unique
- **Processus de Pensée Transparent** : Voyez en temps réel ce que l'IA pense, peut intervenir et guider à tout moment
- **Vraiment Gratuit et Open Source** : Licence MIT, aucune barrière de paiement

## 🚀 Démarrage Rapide

### Premier Utilisation

```bash
# 1. Cloner le projet
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. Exécuter le script d'installation (configure automatiquement l'environnement)
./setup.sh

# 3. Démarrer le service
./start.sh
```

### Utilisation Ultérieure

```bash
# Démarrage rapide direct (environnement déjà installé)
./start.sh
```

Le service s'exécute par défaut sur http://localhost:5000

> **Note** : Si le port 5000 est occupé (par exemple, AirPlay sur macOS), le système sélectionnera automatiquement le prochain port disponible (5001-5010) et affichera le port réel utilisé au démarrage.

## ⚙️ Instructions de Configuration

### Configuration de Base

1. **Copier le fichier de configuration d'environnement**
   ```bash
   cp .env.example .env
   ```

2. **Modifier le fichier .env pour configurer les éléments suivants**
   - `OPENAI_API_KEY` : Votre clé API OpenAI
   - `OPENAI_BASE_URL` : Point de terminaison de l'API (optionnel, utilise par défaut le point de terminaison officiel)
   - Informations de connexion à la base de données

### Configuration de la Couche Sémantique (Optionnel)

La couche sémantique améliore la compréhension des termes métiers, aidant le système à mieux comprendre votre langage métier. **Ceci est une configuration optionnelle, ne pas la configurer n'affecte pas les fonctionnalités de base.**

1. **Copier le fichier d'exemple**
   ```bash
   cp backend/semantic_layer.json.example backend/semantic_layer.json
   ```

2. **Modifier la configuration selon vos besoins métiers**
   
   La configuration de la couche sémantique contient trois parties :
   - **Mapping de Base de Données** : Définit la signification métier de la base de données
   - **Tables Métiers Principales** : Mappe les tables et champs métiers importants
   - **Index de Recherche Rapide** : Recherche rapide de termes courants

3. **Exemple de Configuration**
   ```json
   {
     "Tables Métiers Principales": {
       "Gestion des Commandes": {
         "Chemin de Table": "database.orders",
         "Mots-clés": ["commande", "vente", "transaction"],
         "Champs Requis": {
           "order_id": "Numéro de Commande",
           "amount": "Montant"
         }
       }
     }
   }
   ```

> **Note** : 
> - Le fichier de couche sémantique contient des informations métiers sensibles et a été ajouté à `.gitignore`, ne sera pas soumis au contrôle de version
> - Lorsque la couche sémantique n'est pas configurée, le système utilise la configuration par défaut et peut toujours effectuer des requêtes de données normalement
> - Pour des instructions de configuration détaillées, voir [backend/SEMANTIC_LAYER_SETUP.md](backend/SEMANTIC_LAYER_SETUP.md)

## 📁 Structure du Projet

```
QueryGPT/
├── backend/              # Service backend
│   ├── app.py           # Point d'entrée principal de l'application Flask
│   ├── database.py      # Gestion de la connexion à la base de données
│   ├── interpreter_manager.py  # Interpréteur de requêtes
│   ├── history_manager.py      # Gestion de l'historique
│   └── config_loader.py        # Chargeur de configuration
├── frontend/            # Interface frontend
│   ├── templates/       # Modèles HTML
│   └── static/          # Ressources statiques
│       ├── css/         # Fichiers de style
│       └── js/          # JavaScript
├── docs/                # Documentation du projet
├── logs/                # Répertoire des logs
├── output/              # Fichiers de sortie
├── requirements.txt     # Dépendances Python
└── .env.example         # Exemple de configuration
```

## 🔌 API

### Interface de Requête

```http
POST /api/chat
Content-Type: application/json

{
  "message": "Consulter le total des ventes de ce mois",
  "model": "default"
}
```

### Historique

```http
GET /api/history/conversations    # Obtenir la liste de l'historique
GET /api/history/conversation/:id # Obtenir les détails
DELETE /api/history/conversation/:id # Supprimer l'enregistrement
```

### Vérification de Santé

```http
GET /api/health
```

## 🔒 Informations de Sécurité

- Supporte uniquement les requêtes en lecture seule (SELECT, SHOW, DESCRIBE)
- Filtre automatiquement les déclarations SQL dangereuses
- Les utilisateurs de la base de données doivent être configurés avec des permissions en lecture seule

## 📄 Licence

MIT License - Voir le fichier [LICENSE](LICENSE) pour les détails

## 🆕 Dernières Mises à Jour

- 2025-09-05 – Optimisation de la vitesse de démarrage : Suppression du test automatique par lots lors de la première entrée sur la page des modèles, réduisant les requêtes inutiles et évitant l'écriture incorrecte de l'état.

## 👨‍💻 Auteur

- **Auteur** : Mao Kaiyue
- **GitHub** : [@MKY508](https://github.com/MKY508)
- **Date de Création** : Août 2025

## ⭐ Star History

<div align="center">
  <a href="https://star-history.com/#MKY508/QueryGPT&Date">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date&theme=dark" />
      <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
      <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=MKY508/QueryGPT&type=Date" />
    </picture>
  </a>
</div>

## 🤝 Contribution

Bienvenue pour soumettre des Issues et Pull Requests.

1. Forkez ce projet
2. Créez une branche de fonctionnalité (`git checkout -b feature/AmazingFeature`)
3. Committez vos modifications (`git commit -m 'Add some AmazingFeature'`)
4. Poussez vers la branche (`git push origin feature/AmazingFeature`)
5. Ouvrez une Pull Request
