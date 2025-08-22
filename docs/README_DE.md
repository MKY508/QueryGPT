<div align="center">
  
  <img src="images/logo.png" width="400" alt="QueryGPT">
  
  <br/>
  
  <p>
    <a href="../README.md">English</a> •
    <a href="README_CN.md">简体中文</a> •
    <a href="#">Deutsch</a>
  </p>
  
  <br/>
  
  [![License](https://img.shields.io/badge/Lizenz-MIT-yellow.svg?style=for-the-badge)](LICENSE)
  [![Python](https://img.shields.io/badge/Python-3.10+-blue.svg?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
  [![OpenInterpreter](https://img.shields.io/badge/OpenInterpreter-0.4.3-green.svg?style=for-the-badge)](https://github.com/OpenInterpreter/open-interpreter)
  [![Stars](https://img.shields.io/github/stars/MKY508/QueryGPT?style=for-the-badge&color=yellow)](https://github.com/MKY508/QueryGPT/stargazers)
  
  <br/>
  
  <h3>Ein intelligenter Datenanalyse-Agent basierend auf OpenInterpreter</h3>
  <p><i>Kommunizieren Sie mit Ihrer Datenbank in natürlicher Sprache</i></p>
  
</div>

<br/>

---

## ✨ Projektbeschreibung

**QueryGPT** ist ein revolutionäres intelligentes Datenabfragesystem, das die Lücke zwischen natürlicher Sprache und Datenbankabfragen überbrückt. Basierend auf OpenInterpreter 0.4.3, ermöglicht es Benutzern, komplexe Datenanalysen durch einfache Konversationen in natürlicher Sprache durchzuführen - ohne SQL-Kenntnisse zu benötigen.

Das System denkt wie ein erfahrener Datenanalyst: Es erkundet autonom Datenstrukturen, validiert Ergebnisse durch mehrere Iterationen und kann sowohl SQL als auch Python für erweiterte statistische Analysen und maschinelles Lernen ausführen. Die transparente Chain-of-Thought-Visualisierung zeigt den Denkprozess der KI in Echtzeit, sodass Benutzer jederzeit eingreifen und lenken können.

## 🌟 Hauptfunktionen

### KI-Agent Kernfähigkeiten
- **Autonome Datenexploration**: Der Agent versteht proaktiv Datenstrukturen und erkundet Beziehungen
- **Mehrstufiges Reasoning**: Untersucht Probleme tiefgehend wie ein echter Analyst
- **Chain-of-Thought Visualisierung**: Echtzeit-Anzeige des KI-Denkprozesses mit Interventionsmöglichkeit
- **Kontextgedächtnis**: Versteht Gesprächsverlauf und unterstützt kontinuierliche mehrstufige Analysen

### Datenanalysefähigkeiten
- **SQL + Python Integration**: Nicht auf SQL beschränkt - führt komplexe Python-Datenverarbeitung aus
- **Statistische Analyse**: Automatische Korrelationsanalyse, Trendvorhersage, Anomalieerkennung
- **Geschäftsterminologie**: Natives Verständnis von YoY, MoM, Retention, Repurchase-Konzepten
- **Intelligente Visualisierung**: Wählt automatisch den besten Diagrammtyp basierend auf Datencharakteristiken

### Systemfunktionen
- **Multi-Modell-Unterstützung**: Nahtloser Wechsel zwischen GPT-5, Claude, Gemini, Ollama lokalen Modellen
- **Flexible Bereitstellung**: Unterstützt Cloud-API oder Ollama lokale Bereitstellung - Ihre Daten verlassen nie Ihre Räumlichkeiten
- **Verlaufsspeicherung**: Speichert Analyseprozesse mit Rückverfolgung und Freigabefunktionen
- **Datensicherheit**: Nur-Lese-Berechtigungen, SQL-Injection-Schutz, sensible Datenmaskierung
- **Flexible Exportoptionen**: Unterstützt Excel, PDF, HTML und andere Formate

## 🚀 Technologie-Stack

### Backend-Technologien
- **Python 3.10.x** (Erforderlich für OpenInterpreter 0.4.3)
- **Flask** - Leichtgewichtiges Web-Framework
- **OpenInterpreter 0.4.3** - Kern-KI-Ausführungsumgebung
- **MySQL/MariaDB** - Datenbankunterstützung
- **Redis** (Optional) - Caching-Layer für Leistung

### Frontend-Technologien
- **HTML5/CSS3** - Moderne Webstandards
- **JavaScript (ES6+)** - Interaktive Benutzeroberfläche
- **Chart.js** - Datenvisualisierung
- **WebSocket** - Echtzeit-Kommunikation

### KI-Modelle
- **OpenAI GPT-Serie** (GPT-4, GPT-5)
- **Anthropic Claude**
- **Google Gemini**
- **Lokale Modelle via Ollama** (Qwen, Llama, etc.)

## ⚡ Schnellstart

### Systemanforderungen
- Python 3.10.x (Zwingend erforderlich)
- MySQL 5.7+ oder kompatible Datenbank
- 4GB RAM minimum (8GB empfohlen)
- 2GB freier Festplattenspeicher

### Installation

```bash
# 1. Repository klonen
git clone https://github.com/MKY508/QueryGPT.git
cd QueryGPT

# 2. Setup-Skript ausführen (automatische Umgebungskonfiguration)
./setup.sh

# 3. Umgebungsvariablen konfigurieren
cp .env.example .env
# Bearbeiten Sie .env mit Ihrem bevorzugten Editor

# 4. Service starten
./start.sh
```

### Schnellstart für bestehende Installationen

```bash
# Direkter Schnellstart
./quick_start.sh
```

Der Service läuft standardmäßig auf http://localhost:5000

> **Hinweis**: Wenn Port 5000 belegt ist (z.B. macOS AirPlay), wählt das System automatisch den nächsten verfügbaren Port (5001-5010) und zeigt den tatsächlich verwendeten Port beim Start an.

## 💡 Verwendung

### Grundlegende Abfragen

1. **Einfache Datenabfrage**
   ```
   "Zeige mir die Gesamtverkäufe dieses Monats"
   "Welche Produkte haben die höchste Gewinnmarge?"
   ```

2. **Komplexe Analyse**
   ```
   "Analysiere die Verkaufstrends der letzten 6 Monate und prognostiziere die nächsten 3 Monate"
   "Finde Korrelationen zwischen Kundendemografie und Kaufverhalten"
   ```

3. **Datenvisualisierung**
   ```
   "Erstelle ein Balkendiagramm der Top 10 Produkte nach Umsatz"
   "Zeige die geografische Verteilung unserer Kunden auf einer Karte"
   ```

### API-Nutzung

```python
import requests

# Abfrage senden
response = requests.post('http://localhost:5000/api/chat', 
    json={
        'message': 'Analysiere die Verkaufsdaten',
        'model': 'default',
        'stream': False
    }
)

# Ergebnis verarbeiten
result = response.json()
print(result['result']['content'])
```

### Konfigurationsoptionen

```json
{
  "database": {
    "host": "localhost",
    "port": 3306,
    "user": "readonly_user",
    "database": "business_data"
  },
  "ai": {
    "model": "gpt-4",
    "temperature": 0.7,
    "max_tokens": 2000
  },
  "security": {
    "enable_sql_validation": true,
    "mask_sensitive_data": true
  }
}
```

## 📋 Systemanforderungen

### Mindestanforderungen
- **Betriebssystem**: Linux, macOS, Windows (mit WSL2)
- **Python**: 3.10.x (genau diese Version erforderlich)
- **RAM**: 4GB
- **Festplatte**: 2GB freier Speicherplatz
- **Datenbank**: MySQL 5.7+ oder MariaDB 10.3+

### Empfohlene Anforderungen
- **RAM**: 8GB oder mehr
- **CPU**: 4 Kerne oder mehr
- **Festplatte**: SSD mit 10GB freiem Speicherplatz
- **Netzwerk**: Stabile Internetverbindung für Cloud-KI-Modelle

### Unterstützte Datenbanken
- MySQL 5.7+
- MariaDB 10.3+
- PostgreSQL 12+ (experimentell)
- SQLite (für Entwicklung/Tests)

## 🌍 Mehrsprachige Unterstützung

QueryGPT unterstützt aktuell **10 Sprachen** für natürliche Sprachabfragen:

- 🇬🇧 Englisch
- 🇨🇳 Chinesisch (Vereinfacht & Traditionell)
- 🇩🇪 Deutsch
- 🇫🇷 Französisch
- 🇪🇸 Spanisch
- 🇯🇵 Japanisch
- 🇰🇷 Koreanisch
- 🇷🇺 Russisch
- 🇵🇹 Portugiesisch
- 🇮🇹 Italienisch

Das System erkennt automatisch die Sprache Ihrer Abfrage und antwortet in derselben Sprache.

## 🔒 Sicherheit & Datenschutz

- **Nur-Lese-Zugriff**: Alle Datenbankoperationen sind schreibgeschützt
- **SQL-Injection-Schutz**: Robuste Eingabevalidierung und -sanitisierung
- **Datenmaskierung**: Automatische Maskierung sensibler Informationen
- **Lokale Bereitstellung**: Option für vollständig lokale Ausführung ohne Cloud-Abhängigkeiten
- **Audit-Protokollierung**: Vollständige Protokollierung aller Abfragen und Zugriffe

## 📄 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert - siehe die [LICENSE](../LICENSE) Datei für Details.

Die MIT-Lizenz ist eine freizügige Open-Source-Lizenz, die es Ihnen erlaubt:
- Das Projekt kommerziell zu nutzen
- Den Code zu modifizieren
- Den Code zu verteilen
- Das Projekt privat zu nutzen

## 🤝 Beitragen

Wir freuen uns über Beiträge! So können Sie helfen:

1. Forken Sie das Repository
2. Erstellen Sie einen Feature-Branch (`git checkout -b feature/AmazingFeature`)
3. Committen Sie Ihre Änderungen (`git commit -m 'Add some AmazingFeature'`)
4. Pushen Sie zum Branch (`git push origin feature/AmazingFeature`)
5. Öffnen Sie einen Pull Request

## 📞 Support & Kontakt

- **GitHub Issues**: [github.com/MKY508/QueryGPT/issues](https://github.com/MKY508/QueryGPT/issues)
- **Diskussionen**: [github.com/MKY508/QueryGPT/discussions](https://github.com/MKY508/QueryGPT/discussions)
- **Autor**: Mao Kaiyue ([@MKY508](https://github.com/MKY508))

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

---

<div align="center">
  <sub>Mit ❤️ entwickelt von der QueryGPT Community</sub>
</div>