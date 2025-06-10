# arcgis-widgets

Custom ArcGIS Web AppBuilder Widgets

## **Multi Filter**

While ESRI's out-of-the-box widgets (**Filter** and **Group Filter**) cover useful swaths of functionality, the journey for configuring and applying filters for multiple layers remains cumbersome. **Filter** lacks the multi-layer capability, and **Group Filter** lacks many of the useful features of **Filter**.

**Multi Filter** aims to fill this gap, offering a shortcut for applying filters to multiple layers via the familiar UI of the original **Filter** widget. For maps containing many layers of data with common fields, this eliminates the need for configuring many filters explicitly. All out-of-the-box **Filter** capabilities (like the multi-select dropdown via `IS ANY OF` and the ability to `Filter by previous expression(s)`) are natively supported.

**Multi Filter** applies *partial* filters to layers where possible, i.e., if `layer_1` contains fields `A` and `B`, but the incoming filter query was specified as `A > 1 AND (B > 2 OR C > 3)`, then the widget will deconstruct / reconstruct and apply the partial query `A > 1 AND B > 2`. This is accomplished by SQL tokenization logic, under the hood, aiming to support any SQL that may be passed by a `Filter` widget config.
