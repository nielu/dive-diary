/// <reference path="../pb_data/types.d.ts" />

// Short video clips live in the photos collection, so they show up in the same
// grid, attach to markers the same way and play in "Follow the route".
// A clip's `image` is its poster frame (thumbnails and the offline cache work
// as for photos); `video` is an H.264 MP4 the browser prepared before upload.
migrate(
  (app) => {
    const photos = app.findCollectionByNameOrId("photos");
    photos.fields.add(
      new FileField({
        name: "video",
        maxSelect: 1,
        maxSize: 200 * 1024 * 1024, // about 3 minutes at the app's 8 Mbit/s
        mimeTypes: ["video/mp4"],
        protected: true,
      }),
    );
    photos.fields.add(new NumberField({ name: "duration", min: 0 })); // seconds
    photos.fields.add(new NumberField({ name: "width", min: 0, onlyInt: true }));
    photos.fields.add(new NumberField({ name: "height", min: 0, onlyInt: true }));
    app.save(photos);
  },
  (app) => {
    const photos = app.findCollectionByNameOrId("photos");
    for (const name of ["video", "duration", "width", "height"]) photos.fields.removeByName(name);
    app.save(photos);
  },
);
