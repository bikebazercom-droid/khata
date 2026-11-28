# Launcher artwork

`icon.png` uses the actual Banglakhata Google Play listing artwork, not a
recreation or a screenshot crop.

Source listing: https://play.google.com/store/apps/details?id=com.banglakhata.app

`adaptive-icon.png` contains that same artwork centered on a transparent square
at 60% of the canvas width. Keep this padding: Android masks adaptive icons into
different shapes, and the title at the bottom must stay inside the central safe
area. The blue adaptive background is configured in `app.json`.

Both files are 1024 × 1024 PNGs. Do not point the adaptive foreground at the
unpadded full-bleed icon.

Android launcher resources are generated locally and are not tracked in this
repository. Any build using an existing native Android directory must refresh
its launcher resources from these assets; changing Expo configuration alone
does not rewrite an already-generated native project. A newly built and
installed app update is required for existing users to receive the new icon.
