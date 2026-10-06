/** Compact domain symbols; the accompanying IFC type remains the authoritative label. */
export function createIfcTypeIcon() {
  return {
    name: "IfcTypeIcon",
    props: {type: String},
    computed: {
      shape() {
        if (/Project|Site/.test(this.type)) return "M3 4h18v16H3zM3 9h18M8 4v16M16 9v11";
        if (/Storey|Slab|Roof/.test(this.type)) return "M3 8l9-5 9 5-9 5zM3 13l9 5 9-5M3 18l9 5 9-5";
        if (/Building$/.test(this.type)) return "M5 21V3h14v18M9 7h2M13 7h2M9 11h2M13 11h2M10 21v-6h4v6";
        if (/Wall/.test(this.type)) return "M3 4h18v16H3zM3 9h18M3 15h18M8 4v5M16 4v5M12 9v6M8 15v5M16 15v5";
        if (/Door/.test(this.type)) return "M5 21V3h14v18M3 21h18M14 12h1";
        if (/Window/.test(this.type)) return "M4 4h16v16H4zM12 4v16M4 12h16";
        if (/Stair/.test(this.type)) return "M3 20h5v-5h5v-5h5V5h3";
        if (/Space/.test(this.type)) return "M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6";
        return "M4 7l8-4 8 4v10l-8 4-8-4zM4 7l8 5 8-5M12 12v9";
      }
    },
    template: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path :d="shape"/></svg>`
  };
}
