# Documented fixtures — NOT recordings

Every file here is copied from, or built field by field on, what SiteMinder **publishes** for the Direct
Booking API — the OpenAPI embedded in its reference pages, the old YAML's `Quote.example`, and the quick
start's error bodies (`docs/design/siteminder-provider/design-notes.md` §1). None was recorded from a live
call: no Direct Booking key was available when the provider was written, and SiteMinder documents no sandbox.

The add-provider recipe asks for anonymized recordings. These stand in until the first live call with a
hotel's key (design-notes §6, step 1), which replaces them with recordings in `__fixtures__/` and deletes
this folder. Values that are not SiteMinder's own example (the rate uuid, names, the cancellation text)
are placeholders, not observations.
