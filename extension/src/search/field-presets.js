// Portable search configuration v1. No browser or Chrome APIs.
// Related terms are search suggestions, not claims of mathematical equivalence.
export const FIELD_PRESETS = [
  { id: "all", name: "All fields", arxivCategories: [], broadCategories: [], terms: [], rules: [] },
  {
    id: "algebraic-geometry", name: "Algebraic Geometry", arxivCategories: ["math.AG"], broadCategories: ["math.AG", "math.AC", "math.DG"],
    terms: ["algebraic geometry", "moduli spaces", "derived algebraic geometry", "birational geometry"],
    rules: [
      { match: ["algebraic geometry"], balanced: ["algebraic varieties"], broad: ["derived algebraic geometry", "birational geometry", "moduli spaces"] },
      { match: ["moduli", "moduli spaces"], balanced: ["moduli space", "moduli stacks"], broad: ["deformation theory", "algebraic stacks"] },
    ],
  },
  {
    id: "representation-theory", name: "Representation Theory", arxivCategories: ["math.RT"], broadCategories: ["math.RT", "math.QA", "math.RA"],
    terms: ["representation theory", "representations", "quiver representations", "highest weight"],
    rules: [
      { match: ["representation theory", "representations"], balanced: ["representation theory", "representations"], broad: ["quiver representations", "highest weight", "categorification"] },
      { match: ["quiver", "quiver representations"], balanced: ["quiver representations"], broad: ["path algebras", "representations of algebras", "quiver varieties"] },
    ],
  },
  {
    id: "homological-algebra", name: "Homological Algebra", arxivCategories: ["math.RA", "math.CT"], broadCategories: ["math.RA", "math.CT", "math.KT"],
    terms: ["homological algebra", "derived functors", "chain complexes", "derived categories"],
    rules: [
      { match: ["homological algebra"], balanced: ["derived functors", "chain complexes"], broad: ["derived categories", "differential graded algebras"] },
      { match: ["derived category", "derived categories"], balanced: ["derived category", "derived categories"], broad: ["triangulated categories", "dg categories", "differential graded categories"] },
    ],
  },
  {
    id: "mirror-symmetry", name: "Mirror Symmetry", arxivCategories: ["math.AG", "math.SG"], broadCategories: ["math.AG", "math.SG", "math.QA"],
    terms: ["mirror symmetry", "Landau-Ginzburg", "Fukaya category", "matrix factorization", "Gromov-Witten", "FJRW", "quantum cohomology"],
    rules: [
      { match: ["mirror symmetry", "mirror"], balanced: ["mirror symmetry", "homological mirror symmetry"], broad: ["Landau-Ginzburg", "Fukaya category", "matrix factorization"] },
      { match: ["Landau-Ginzburg", "Landau Ginzburg"], balanced: ["Landau-Ginzburg", "Landau Ginzburg"], broad: ["matrix factorization", "FJRW", "mirror symmetry"] },
      { match: ["Gromov-Witten", "Gromov Witten"], balanced: ["Gromov-Witten", "Gromov Witten"], broad: ["quantum cohomology", "enumerative geometry", "FJRW"] },
    ],
  },
  {
    id: "symplectic-geometry", name: "Symplectic Geometry", arxivCategories: ["math.SG"], broadCategories: ["math.SG", "math.DG", "math.AG"],
    terms: ["symplectic geometry", "symplectic topology", "Floer homology", "Fukaya category"],
    rules: [
      { match: ["symplectic geometry", "symplectic topology"], balanced: ["symplectic geometry", "symplectic topology"], broad: ["Floer homology", "Lagrangian submanifolds", "Fukaya category"] },
      { match: ["Floer", "Floer homology"], balanced: ["Floer homology", "Floer cohomology"], broad: ["Lagrangian Floer", "Hamiltonian Floer", "Fukaya category"] },
    ],
  },
  {
    id: "category-theory", name: "Category Theory", arxivCategories: ["math.CT"], broadCategories: ["math.CT", "math.AT", "math.QA"],
    terms: ["category theory", "categorical", "higher categories", "infinity categories"],
    rules: [
      { match: ["category theory", "categorical"], balanced: ["category theory", "categorical"], broad: ["higher categories", "monoidal categories", "enriched categories"] },
      { match: ["infinity categories", "infinity category"], balanced: ["infinity categories", "infinity category"], broad: ["higher categories", "quasicategories", "model categories"] },
    ],
  },
  {
    id: "applied-topology", name: "Persistence / Applied Topology", arxivCategories: ["math.AT", "cs.CG"], broadCategories: ["math.AT", "cs.CG", "stat.ML"],
    terms: ["persistent homology", "persistence modules", "topological data analysis", "persistence diagrams"],
    rules: [
      { match: ["persistence", "persistent homology"], balanced: ["persistent homology", "persistence modules"], broad: ["persistence diagrams", "topological data analysis", "barcodes"] },
      { match: ["topological data analysis", "TDA"], balanced: ["topological data analysis", "persistent homology"], broad: ["persistence diagrams", "Mapper", "applied topology"] },
    ],
  },
];
