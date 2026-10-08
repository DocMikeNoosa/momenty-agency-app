# Momenty Agency – aplikacja agencji

Prywatna aplikacja (PWA) dla **Momenty Agency** (Warszawa), zaprojektowana przede wszystkim na telefon. Ciemny, bordowy
„szklany” wygląd z błyszczącymi przyciskami. W środku: plan dnia, projekty z wyceną i umowami, klienci / influencerzy /
media / partnerzy, zdjęcia i pliki, asystent AI wykonujący polecenia mówione lub pisane, przypomnienia w Kalendarzu
Google, Canva i Instagram. Aplikacja jest w całości po polsku.

**Konfiguracja (administrator, jednorazowo): zobacz [SETUP.md](SETUP.md)** (instrukcja po angielsku).

## Gdzie działa
- **iPhone / iPad** – Safari → Udostępnij → *Do ekranu początkowego*. Pełny ekran, działa bez internetu, Face ID.
  Bez App Store.
- **Mac / PC** – dowolna nowoczesna przeglądarka; w Chrome/Edge można też „Zainstalować aplikację”.

## Funkcje
- **Dziś** – zaległe, dzisiejsze i najbliższe 7 dni, projekty w toku, klienci wymagający uwagi, aktywność obu osób.
- **Prosta nawigacja** – 4 zakładki (*Dziś · Projekty · Kontakty · Więcej*) i przycisk **✦ Asystent** na każdym
  ekranie: napisz lub podyktuj polecenie albo dodaj zadanie / projekt / kontakt / zdjęcie / pismo / makietę.
  Krótkie powitanie z 3 wskazówkami przy pierwszym uruchomieniu.
- **Projekty** – 3 zakładki: *Przegląd* (etap, zadania, brief, influencerzy) · *Wycena i umowa* (pozycje, VAT, rabat,
  propozycja ceny od AI do edycji, oferta PDF, umowa) · *Pliki i dokumenty* (zdjęcia, pliki, Canva, pisma).
  Przyciski AI na górze projektu – jedno stuknięcie: e-mail do klienta o postępach, propozycja wyceny, umowa,
  makieta posta na Instagram, plan kolejnych kroków, informacja prasowa. AI zna już projekt, klienta i wycenę.
- **Kontakty** – klienci (z danymi do umów), influencerzy (obserwujący, zaangażowanie, stawki, ocena), media,
  partnerzy. Jednym stuknięciem: telefon / SMS / e-mail / Instagram / TikTok; wyszukiwanie na Instagramie.
- **Asystent AI** – piszesz lub dyktujesz, a on: tworzy zadania z przypomnieniami, przygotowuje e-maile (wysyłka przez
  Pocztę lub Gmaila), zakłada projekty i kontakty, zmienia etapy, szuka osób na Instagramie, odpowiada „co mam dziś”.
- **Pisma** – 8 polskich szablonów albo „Napisz z AI”; każda firma dostaje inaczej sformułowany list.
- **Umowy** – z szablonu lub AI, na podstawie zakresu projektu, wyceny i danych obu stron (zawsze projekt do sprawdzenia).
- **Makiety postów i relacji na Instagram** dla klientów (PNG).
- **Kalendarz Google** – każda osoba łączy się raz; jej zadania pojawiają się z przypomnieniami dopasowanymi do rodzaju
  zadania.
- **Canva** – stałe połączenie z Canvą: edytujesz grafikę projektu w Canvie i wracasz do automatycznie zaktualizowanej
  wersji; import projektów (PNG/PDF), tworzenie nowych.
- **Bezpieczeństwo** – hasło + klucze dostępu (Face ID / Touch ID / Windows Hello), automatyczna blokada; dostęp do
  danych w chmurze tylko dla osób zaproszonych przez administratora (zabezpieczenia na poziomie bazy danych);
  klucze API tylko na serwerze. Repozytorium na GitHubie zawiera wyłącznie kod – żadnych danych ani haseł.
- **Synchronizacja i kopie** – synchronizacja w obie strony między urządzeniami, wspólne miejsce na zdjęcia,
  kopie zapasowe (JSON), praca bez internetu.

## Budowa
- Statyczna aplikacja PWA (bez kompilacji): `index.html`, `css/`, `js/`, `sw.js`.
- Serwer: własny projekt **Supabase** – `supabase/schema.sql` (tabele, zabezpieczenia RLS, funkcje parowania,
  zasady przechowywania plików) oraz funkcje w `supabase/functions/` (`ai`, `google`, `canva`).

## Testy
```
npm test                 # testy jednostkowe + pełny test aplikacji w Chromium (iPhone 13 + komputer), tryb lokalny
npm run test:backend     # uruchamia lokalny serwer zgodny z Supabase (Postgres 16, Supabase Auth, PostgREST,
                         # prawdziwe funkcje na Deno, atrapy Google/Canva/Anthropic) i wykonuje:
                         # testy bezpieczeństwa, parowanie i synchronizację dwóch osób, AI/wycenę/umowy/Kalendarz/Canvę
```
Testy serwera wymagają programów opisanych w `tests/backend/start.sh` (Supabase Auth, PostgREST, Deno) oraz lokalnego
PostgreSQL 16.
