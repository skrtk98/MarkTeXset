---
mathmd:
  meta:
    language: en
    date: 2026-01-01
---

# Linear maps and their spectra

Linear algebra studies vector spaces together with the maps that preserve their structure. A map $T\colon V \to W$ between vector spaces over a field $F$ is linear when $T(au + bv) = aT(u) + bT(v)$ for all vectors $u, v$ and all scalars $a, b$. Although the definition is short, it has far-reaching consequences: once the images of the vectors in a basis are known, the whole map is determined, and every question about $T$ can be translated into a question about a matrix. The translation depends on the choice of bases, and much of the theory is concerned with finding bases in which the matrix becomes as simple as possible.

The kernel and the image are the first invariants one meets. The kernel $\ker T$ consists of the vectors that $T$ sends to zero, and the image $\operatorname{im} T$ consists of the vectors that $T$ actually reaches. Both are subspaces, and for finite-dimensional $V$ their dimensions are tied together by the rank–nullity theorem,

$$\dim V = \dim \ker T + \dim \operatorname{im} T.$$

The theorem explains, for instance, why an injective map between spaces of equal finite dimension is automatically surjective: the kernel is trivial, so the image has full dimension. Arguments of this kind, which trade an analytic statement for a count of dimensions, appear throughout the subject.[^counting]

## Eigenvalues

When the domain and the codomain coincide, it is natural to ask which vectors are merely stretched by $T$. A nonzero vector $v$ is an eigenvector with eigenvalue $\lambda$ when $Tv = \lambda v$. Equivalently, $\lambda$ is an eigenvalue exactly when $T - \lambda I$ fails to be injective, which for matrices means

$$\det(A - \lambda I) = 0.$$

The left-hand side is a polynomial of degree $n$ in $\lambda$, the characteristic polynomial of $A$. Over the complex numbers it always factors completely, so every complex square matrix has at least one eigenvalue. Over the real numbers this can fail: a rotation of the plane by a quarter turn moves every nonzero vector off its own line, and its characteristic polynomial $\lambda^2 + 1$ has no real roots.

Eigenvectors belonging to distinct eigenvalues are linearly independent. Consequently, a matrix with $n$ distinct eigenvalues admits a basis of eigenvectors, and in that basis it is diagonal. Diagonal matrices are easy to understand: their powers, exponentials, and inverses are computed entry by entry. This observation underlies the solution of linear recurrences and of systems of linear differential equations with constant coefficients, where the long-term behaviour is governed by the eigenvalue of largest absolute value.

Not every matrix is diagonalizable. The matrix with ones on the diagonal and a single one above it has only the eigenvalue $1$, but its eigenvectors span a line rather than the whole plane. The Jordan normal form describes precisely how far a matrix is from being diagonal: over an algebraically closed field, every matrix is similar to a block-diagonal matrix whose blocks have a single eigenvalue on the diagonal and ones on the superdiagonal. Although the Jordan form is rarely computed in practice, because it is numerically unstable, it organizes the theory and predicts the polynomial growth that appears in the powers of non-diagonalizable matrices.

## Inner products and the spectral theorem

Additional structure on the vector space yields stronger results. An inner product $\langle u, v \rangle$ makes it possible to speak of lengths, angles, and orthogonality, and it singles out the self-adjoint maps, those satisfying $\langle Tu, v \rangle = \langle u, Tv \rangle$ for all $u$ and $v$. For real symmetric matrices, and more generally for self-adjoint operators on finite-dimensional inner product spaces, the spectral theorem states that

$$A = Q \Lambda Q^{\top},$$

where $Q$ is orthogonal and $\Lambda$ is diagonal with real entries. In other words, a symmetric matrix can be diagonalized by a rotation of the coordinate system, and its eigenvalues are real. The theorem is the foundation of principal component analysis, of the classification of quadratic forms, and of the analysis of vibrating systems, in which the eigenvectors describe the normal modes and the eigenvalues their squared frequencies.

The proof proceeds by induction on the dimension. One first shows that a self-adjoint operator has a real eigenvalue, for example by maximizing the quadratic form $\langle Tv, v \rangle$ on the unit sphere. The orthogonal complement of the corresponding eigenvector is then invariant under $T$, and the restriction of $T$ to this complement is again self-adjoint, so the induction hypothesis applies. The same strategy, with appropriate analytic care, extends to compact self-adjoint operators on Hilbert spaces, which is where the word spectrum acquired its present meaning.

## Singular values

For maps between different spaces, or for matrices that are not symmetric, the singular value decomposition plays the role of the spectral theorem. Every real $m \times n$ matrix can be written as $A = U \Sigma V^{\top}$ with orthogonal $U$ and $V$ and a rectangular diagonal $\Sigma$ whose entries $\sigma_1 \ge \sigma_2 \ge \dots \ge 0$ are the singular values. Geometrically, $A$ maps the unit sphere onto an ellipsoid whose semi-axes have lengths $\sigma_i$. The largest singular value equals the operator norm of $A$, and the ratio of the largest to the smallest nonzero singular value, the condition number, measures how sensitive the solution of $Ax = b$ is to perturbations of $b$.

Truncating the decomposition after the first $k$ terms gives the best approximation of $A$ by a matrix of rank at most $k$, a fact known as the Eckart–Young theorem.[^eckart] This optimality makes the singular value decomposition a central tool in data compression, in the numerical solution of ill-posed problems, and in the analysis of large data sets, where the leading singular vectors often capture the dominant patterns while the remaining ones describe noise.

[^counting]: Counting dimensions is a recurring technique; it also proves that a system with more unknowns than equations has a nontrivial solution.

[^eckart]: The approximation is optimal both in the operator norm and in the Frobenius norm.
