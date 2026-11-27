# Glossary

Game-development terms used in this project, one plain-English line each.

| Term | Meaning |
|---|---|
| **Albedo** | The plain colour of a surface before any lighting (a texture's "colour map"). |
| **Ambient occlusion (AO)** | Darkening in corners, cracks and under overhangs, where light from the sky can't reach. |
| **Anisotropic filtering** | Keeps textures sharp when you see them at a steep angle (e.g. a lane stretching away). |
| **Antialiasing (MSAA)** | Smooths the jagged "staircase" edges of shapes on screen. |
| **Bloom** | A soft glow around very bright things (the sun, lit windows). |
| **BVH (bounding-volume hierarchy)** | A tree of boxes around a mesh's triangles, so a ray test only checks the few triangles near the ray instead of all of them. We use the `three-mesh-bvh` library. |
| **Colour grading** | A final adjustment of the whole image's colours (warmth, saturation, contrast). |
| **Dado** | The lower band of a wall finished differently from the rest (here: rough grey render a metre or so high). |
| **Decal** | A flat patch drawn on top of a surface to add a mark (our grime streaks under window sills). |
| **Draw call** | One instruction to the graphics card to draw a batch of triangles; fewer is faster. |
| **Face-aligned projection** | Our way of putting a texture on a flat face: it's laid flat along that face's own direction, so walls at any angle and wedge houses get an undistorted texture. |
| **Frame time** | How long one picture takes to make, in milliseconds (16.7 ms = 60 frames per second). |
| **Bedding plane / strata** | The flat layers rock was laid down in. Ours are tilted (they "dip" about 55°), which is why the cliffs are striped diagonally. |
| **Budget (instance budget)** | A cap on how many copies of something (bushes, say) are drawn; lower quality settings get a smaller budget. |
| **Contour line** | A line joining points of equal height. Terrace walls follow contour lines. |
| **Dead band / hysteresis** | A deliberate gap between the "too slow" and "fast enough" thresholds, so a setting doesn't flip back and forth. |
| **Heightfield** | Terrain stored as a grid of heights (one number per grid point) rather than as a 3D model. |
| **Hitch** | One unusually long frame (a pause), e.g. while a shader compiles. |
| **Instancing** | Drawing many copies of the same small object (windows, shutters) in one draw call. |
| **Interior mapping** | A shader trick that makes a flat window look like it has a room behind it. |
| **LOD bias (mip bias)** | Asks the GPU for a blurrier version of a texture on purpose (used for the soft style). |
| **LOD (level of detail)** | Showing a simpler version of something when it is far away (or not at all when it would be a few pixels). |
| **Marching squares** | A simple method for tracing contour lines through a grid of heights. |
| **Mipmaps** | Smaller pre-shrunk copies of a texture, used for distant surfaces so they don't shimmer. |
| **Normal map** | A texture that stores tiny surface bumps as directions, so flat walls catch light like rough stone. |
| **PBR (physically based rendering)** | Lighting that follows real-world rules (roughness, metalness) so materials look consistent. |
| **Procedural** | Made by code (maths and noise) rather than drawn or photographed. |
| **Quoins** | The corner stones of a building; in Liguria often just painted on, long and short blocks alternating. |
| **Raycast / ray test** | Shooting an invisible line into the scene to see what it hits (used for clicking and camera collision). |
| **Roughness map** | A texture saying how shiny (smooth) or matte (rough) each spot of a surface is. |
| **Shader** | A small program that runs on the graphics card and decides each pixel's colour. |
| **Render pass** | One drawing of the scene (or of a full-screen effect). A frame is several passes: mirror, scene, effects. |
| **Shadow map** | A picture of the scene from the sun's point of view, used to work out what's in shadow. |
| **sRGB / linear** | Two ways to store colour values; colour textures are sRGB, data textures (normals, roughness) are linear. |
| **SSAO** | Screen-space ambient occlusion: AO worked out from the finished image each frame (costly; High only). |
| **String course** | A horizontal band across a facade at a floor line (moulded or painted). |
| **Texture array** | Many same-sized textures stacked in one GPU object; a shader picks a layer by number. |
| **Texture compression** | Storing textures in smaller formats: WebP shrinks downloads; GPU formats (KTX2/Basis) also shrink video memory. |
| **Tiling / repetition** | A texture repeated across a big surface; visible repetition looks fake, so we vary it. |
| **Tint** | Multiplying a (often greyscale) texture by a colour, so one texture serves many colours. |
| **Trompe-l'oeil** | "Fools the eye": architecture painted flat onto plaster (window frames, cornices, even whole windows with a cat). |
| **Triplanar mapping** | Projects a texture from three directions (x, y, z) and blends them by the surface angle, so terrain and cliffs never stretch. |
| **Watchdog** | Code that keeps an eye on something (here: frame times) and acts only if it stays bad for a while. |
| **Uniform** | A value passed from JavaScript to a shader for every pixel (e.g. the time of day). |
| **Vertex colour** | A colour stored on each corner of a triangle, blended across it. |
| **WebP** | A compact image format browsers understand; our packed textures use it. |
