# Requirements illustration system

The surface is Read mode: a grayscale gallery supporting the SRD, with editable vector masters and PNGs for document embedding. The user's pinned wireframe direction controls palette and visual detail.

- **Interface plates:** 1560×1100 SVG viewBox, two 720-wide frames, before state on the left and resulting state on the right. Fixed AP-UI numbering connects each plate to the document.
- **Story maps:** 2160×1130 SVG viewBox. Horizontal columns show operation order; vertical rows show five planned delivery slices. US short codes refer to AP-US. Maps reconstruct the v0.3 tables and are not Miro screenshots.
- **Typography:** Microsoft JhengHei with Noto Sans TC/sans-serif fallbacks; 36px plate titles, 27–28px state/section headings, 21–23px details. Tabular numerals support arithmetic comparisons.
- **Palette:** white background, #252525 text, #333 emphasized controls, #ececec headers, #f3f3f3 notes, #777 borders. White labels on dark controls identify selected/primary actions. Status is stated in text rather than color.
- **Geometry:** crisp rectangular borders and straight separators. Diagram controls are static drawings. No decorative imagery, motion, or claim of live interaction is added.
- **Gallery:** a 1600px content measure, wrapping anchor contents, underlined downloads, visible keyboard focus, and local horizontal illustration scrolling below the 1000px minimum display width. Mobile preserves diagram readability through scrolling. Print removes gallery navigation/download rows and allows vectors to scale.
- **Truth labels:** every interface identifies anonymous test data and planned behavior. Test rules do not become official 113 requirements. Partial coverage remains partial; unknown data stays unknown; manual overrides do not imply school certification. Future offerings and schedule feasibility remain unverified until supported by data.
- **Maintenance:** edit `build_assets.py`, regenerate SVG/HTML, recapture PNGs after fonts settle, and retain capture evidence/provenance. PNG metadata and manifest record method, SVG source/hash, derivation, capture date, and PNG hash. The final `ui06-rules` separates its authorization sentence from the note border and correctly identifies the published version. Keep the main application outside this document-artifact scope.
