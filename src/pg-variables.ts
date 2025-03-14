export const pgVariables = new Set([
    'BR',
    'BRBR',
    'PAR',
    'LQ',
    'RQ',
    'BM',
    'EM',
    'BDM',
    'EDM',
    'LTS',
    'GTS',
    'LTE',
    'GTE',
    'SOL',
    'SOLUTION',
    'HINT',
    'COMMENT',
    'US',
    'SPACE',
    'NBSP',
    'NDASH',
    'MDASH',
    'BLABEL',
    'ELABEL',
    'BBOLD',
    'EBOLD',
    'BITALIC',
    'EITALIC',
    'BUL',
    'EUL',
    'BCENTER',
    'ECENTER',
    'BLTR',
    'ELTR',
    'BKBD',
    'EKBD',
    'HR',
    'LBRACE',
    'RBRACE',
    'LB',
    'RB',
    'DOLLAR',
    'PERCENT',
    'CARET',
    'PI',
    'E',
    'LATEX',
    'TEX',
    'APOS',
    'showPartialCorrectAnswers',
    'refreshCachedImages',
    'ITEM',
    'ITEMSEP',
    'displayMode',
    'problemSeed'
]);

// Note: Keep these in alphabetical order within sections to that
// it is easier to compare to the pgOperatorCompletions map.
export const pgOperators = new Set([
    // PG.pl
    'ADD_CSS_FILE',
    'ADD_JS_FILE',
    'ANS',
    'AskSage',
    'DOCUMENT',
    'ENDDOCUMENT',
    'HEADER_TEXT',
    'insertGraph',
    'loadMacros',
    'maketext',
    'NAMED_ANS',
    'POST_HEADER_TEXT',
    'SET_PROBLEM_LANGUAGE',
    'SET_PROBLEM_TEXTDIRECTION',

    // core/Value.pl
    'ColumnVector',
    'Complex',
    'Compute',
    'Context',
    'Formula',
    'Infinity',
    'Interval',
    'List',
    'Matrix',
    'Point',
    'Real',
    'Set',
    'String',
    'Union',
    'Vector',

    // core/PGcommonFunctions.pl
    'abs',
    'acos',
    'acosh',
    'acot',
    'acoth',
    'acsc',
    'acsch',
    'arccos',
    'arccosh',
    'arccot',
    'arccoth',
    'arccsc',
    'arccsch',
    'arcsec',
    'arcsech',
    'arcsin',
    'arcsinh',
    'arctan',
    'arctanh',
    'asec',
    'asech',
    'asin',
    'asinh',
    'atan',
    'atan2',
    'atanh',
    'C',
    'Comb',
    'cos',
    'cosh',
    'cot',
    'coth',
    'csc',
    'csch',
    'ln',
    'log',
    'logten',
    'P',
    'Perm',
    'sec',
    'sech',
    'sgn',
    'sin',
    'sinh',
    'sqrt',
    'tan',
    'tanh',

    // core/PGauxiliaryFunctions.pl
    'ceil',
    'fact',
    'floor',
    'gcd',
    'gcf',
    'isPrime',
    'max',
    'min',
    'preformat',
    'random_coprime',
    'random_pairwise_coprime',
    'random_subset',
    'reduce',
    'repeated',
    'Round',
    'round',
    'step',

    // core/PGbasicmacros.pl
    'begintable',
    'closeDiv',
    'closeSpan',
    'COMMENT',
    'embedPDF',
    'endtable',
    'FEQ',
    'helpLink',
    'HINT',
    'htmlLink',
    'iframe',
    'image',
    'knowlLink',
    'lex_sort',
    'list_random',
    'MODES',
    'non_zero_random',
    'num_sort',
    'OL',
    'openDiv',
    'openSpan',
    'PGsort',
    'random',
    'row',
    'SOLUTION',
    'STATEMENT',
    'TEXT',
    'uniq',
    'video',

    // core/PGessaymacros.pl
    'essay_box',
    'essay_cmp',
    'explanation_box',

    // core/RserveClient.pl
    'rserve_eval',
    'rserve_finish',
    'rserve_finish_plot',
    'rserve_get_file',
    'rserve_query',
    'rserve_start',
    'rserve_start_plot',

    // core/externalData.pl
    'store_number',
    'store_number_list',
    'store_string',

    // core/sage.pl
    'Sage',

    // core/weightedGrader.pl
    'CREDIT_ANS',
    'install_weighted_grader',
    'NAMED_WEIGHTED_ANS',
    'WEIGHTED_ANS',

    // context/*.pl
    'Assignment',
    'Boolean',
    'Congruence',
    'Currency',
    'Cycle',
    'Fraction',
    'Inequality',
    'Integer',
    'Letters',
    'Ordering',
    'Partition',
    'Percent',
    'Permutation',
    'phi',
    'PiecewiseFunction',
    'primeFactorization',
    'randomPrime',
    'Reaction',
    'root',
    'ScientificNotation',
    'SetBuilder',
    'tau',

    // parser/*.pl
    'AutoStrings',
    'CheckboxList',
    'DefineStrings',
    'DifferenceQuotient',
    'DropDown',
    'DropDownTF',
    'FormulaAnyVar',
    'FormulaUpToConstant',
    'FormulaWithUnits',
    'ImplicitEquation',
    'ImplicitPlane',
    'LinearInequality',
    'LinearRelation',
    'MultiAnswer',
    'NumberWithUnits',
    'OneOf',
    'ParametricLine',
    'ParametricPlane',
    'parserFunction',
    'PopUp',
    'RadioButtons',
    'RadioMultiAnswer',
    'SolutionFor',
    'WordCompletion',

    // graph/*.pl
    'add_functions',
    'closed_circle',
    'createLaTeXImage',
    'createTikZImage',
    'CylindricalPlot3D',
    'Graph3D',
    'GraphTool',
    'init_graph',
    'Live3Ddata',
    'Live3Dfile',
    'LiveGraphics3D',
    'open_circle',
    'ParametricCurve3D',
    'ParametricSurface3D',
    'plot_functions',
    'RectangularPlot3DAnnularDomain',
    'RectangularPlot3DRectangularDomain',
    'VectorField2D',
    'VectorField3D',

    // math/*.pl
    'apply_fraction_to_matrix_entries',
    'change_matrix_entry',
    'DraggableProof',
    'DraggableSubsets',
    'elem_matrix_row_add',
    'elem_matrix_row_mult',
    'elem_matrix_row_switch',
    'factoringMethods',
    'GL2Z',
    'GL3Z',
    'GL4Z',
    'lp_current_value',
    'lp_display',
    'lp_display_mm',
    'lp_display_pivot',
    'lp_pivot_element',
    'lp_solve',
    'random_diag_matrix',
    'random_inv_matrix',
    'rcef',
    'row_add',
    'row_mult',
    'row_switch',
    'rref',
    'SL2Z',
    'SL3Z',
    'SL4Z',

    // misc/*.pl
    'DataTable',
    'LayoutTable',
    'QuickMatrixEntry',
    'randomPerson'
]);

// All PG operators in the set above that are not in the map below will get the default template which is
// `${operator}(\${})\${}`.  So the map below is for operators for which a different template than the default or
// multiple templates are deisred. Note that anything in the map below and not in the set above will be ignored. So make
// sure anything in this map is also in the set above.
export const pgOperatorCompletions = new Map<string, string[]>([
    // PG.pl
    ['DOCUMENT', ['DOCUMENT();']],
    ['ENDDOCUMENT', ['ENDDOCUMENT();']],
    ['loadMacros', ['loadMacros(qw{\n\tPGstandard.pl\n\tPGML.pl${}\n\tPGcourse.pl\n});${}', 'loadMacros(${});${}']],

    // core/PGbasicmacros.pl
    ['list_random', ['list_random(${list})${}']],
    ['non_zero_random', ['non_zero_random(${start}, ${end})${}', 'non_zero_random(${start}, ${end}, ${increment})${}']],
    ['random', ['random(${start}, ${end})${}', 'random(${start}, ${end}, ${increment})${}']]
]);
