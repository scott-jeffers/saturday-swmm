/**
 * Interface language for the navigation and main controls. Model data, SWMM
 * terms and reports stay as they are. English is the source text and the fallback.
 */
import { usePref } from './prefs'

export const LANGUAGES: [string, string][] = [
  ['en', 'English'],
  ['da', 'Dansk'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
]

const T: Record<string, Record<string, string>> = {
  da: {
    'Site data': 'Stedsdata', Search: 'Søg', Projects: 'Projekter', 'Open files': 'Åbn filer', Model: 'Model', Analysis: 'Analyse', Overview: 'Oversigt', Map: 'Kort',
    Elements: 'Elementer', 'Model data': 'Modeldata', Rainfall: 'Nedbør', 'INP editor': 'INP-editor', Results: 'Resultater',
    Scenarios: 'Scenarier', Report: 'Rapport', 'Simulation settings': 'Simuleringsindstillinger', 'Python console': 'Python-konsol',
    'Keyboard shortcuts': 'Tastaturgenveje', 'Light theme': 'Lyst tema', 'Dark theme': 'Mørkt tema', About: 'Om',
    'Collapse sidebar': 'Skjul sidepanel', 'Expand sidebar': 'Vis sidepanel', Run: 'Kør', Check: 'Tjek', 'Check model': 'Tjek model', Stop: 'Stop',
    'Results ready': 'Resultater klar', 'Results out of date': 'Resultater forældede', 'Run failed': 'Kørsel fejlede',
    Edit: 'Rediger', Review: 'Gennemgå', 'Unsaved edits': 'Ikke-gemte ændringer', 'No project open': 'Intet projekt åbent', Quit: 'Afslut',
  },
  es: {
    'Site data': 'Datos del sitio', Search: 'Buscar', Projects: 'Proyectos', 'Open files': 'Abrir archivos', Model: 'Modelo', Analysis: 'Análisis', Overview: 'Resumen', Map: 'Mapa',
    Elements: 'Elementos', 'Model data': 'Datos del modelo', Rainfall: 'Lluvia', 'INP editor': 'Editor INP', Results: 'Resultados',
    Scenarios: 'Escenarios', Report: 'Informe', 'Simulation settings': 'Ajustes de simulación', 'Python console': 'Consola Python',
    'Keyboard shortcuts': 'Atajos de teclado', 'Light theme': 'Tema claro', 'Dark theme': 'Tema oscuro', About: 'Acerca de',
    'Collapse sidebar': 'Contraer barra lateral', 'Expand sidebar': 'Expandir barra lateral', Run: 'Ejecutar', Check: 'Comprobar', 'Check model': 'Comprobar modelo', Stop: 'Detener',
    'Results ready': 'Resultados listos', 'Results out of date': 'Resultados desactualizados', 'Run failed': 'La ejecución falló',
    Edit: 'Editar', Review: 'Revisar', 'Unsaved edits': 'Cambios sin guardar', 'No project open': 'Ningún proyecto abierto', Quit: 'Salir',
  },
  fr: {
    'Site data': 'Données du site', Search: 'Rechercher', Projects: 'Projets', 'Open files': 'Ouvrir des fichiers', Model: 'Modèle', Analysis: 'Analyse', Overview: 'Aperçu', Map: 'Carte',
    Elements: 'Éléments', 'Model data': 'Données du modèle', Rainfall: 'Pluie', 'INP editor': 'Éditeur INP', Results: 'Résultats',
    Scenarios: 'Scénarios', Report: 'Rapport', 'Simulation settings': 'Paramètres de simulation', 'Python console': 'Console Python',
    'Keyboard shortcuts': 'Raccourcis clavier', 'Light theme': 'Thème clair', 'Dark theme': 'Thème sombre', About: 'À propos',
    'Collapse sidebar': 'Réduire la barre latérale', 'Expand sidebar': 'Déplier la barre latérale', Run: 'Lancer', Check: 'Vérifier', 'Check model': 'Vérifier le modèle', Stop: 'Arrêter',
    'Results ready': 'Résultats prêts', 'Results out of date': 'Résultats périmés', 'Run failed': 'Échec du calcul',
    Edit: 'Modifier', Review: 'Contrôler', 'Unsaved edits': 'Modifications non enregistrées', 'No project open': 'Aucun projet ouvert', Quit: 'Quitter',
  },
  de: {
    'Site data': 'Standortdaten', Search: 'Suchen', Projects: 'Projekte', 'Open files': 'Dateien öffnen', Model: 'Modell', Analysis: 'Analyse', Overview: 'Übersicht', Map: 'Karte',
    Elements: 'Elemente', 'Model data': 'Modelldaten', Rainfall: 'Niederschlag', 'INP editor': 'INP-Editor', Results: 'Ergebnisse',
    Scenarios: 'Szenarien', Report: 'Bericht', 'Simulation settings': 'Simulationseinstellungen', 'Python console': 'Python-Konsole',
    'Keyboard shortcuts': 'Tastenkürzel', 'Light theme': 'Helles Design', 'Dark theme': 'Dunkles Design', About: 'Über',
    'Collapse sidebar': 'Seitenleiste einklappen', 'Expand sidebar': 'Seitenleiste ausklappen', Run: 'Berechnen', Check: 'Prüfen', 'Check model': 'Modell prüfen', Stop: 'Stopp',
    'Results ready': 'Ergebnisse bereit', 'Results out of date': 'Ergebnisse veraltet', 'Run failed': 'Berechnung fehlgeschlagen',
    Edit: 'Bearbeiten', Review: 'Prüfen', 'Unsaved edits': 'Ungespeicherte Änderungen', 'No project open': 'Kein Projekt geöffnet', Quit: 'Beenden',
  },
}

export function useT() {
  const lang = usePref('language', 'en')
  return (s: string) => T[lang]?.[s] ?? s
}
