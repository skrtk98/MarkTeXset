---
mathmd:
  meta:
    language: en
    date: 2026-01-01
  layout:
    class: report
---

# Iterative methods

Direct methods such as Gaussian elimination solve a linear system $Ax = b$ in a fixed number of operations, but that number grows with the cube of the dimension, and the factors of a sparse matrix are usually much denser than the matrix itself. For the large sparse systems that arise from discretized partial differential equations, it is often cheaper to start from a guess and improve it step by step, using the matrix only through products with vectors. This chapter introduces the classical stationary methods and the framework used to analyze them.

## Splittings

A stationary method writes the matrix as a difference $A = M - N$, where $M$ is easy to invert, and iterates

$$
x_{k+1} = M^{-1} N x_k + M^{-1} b.
$$

The error $e_k = x_k - x$ then satisfies $e_{k+1} = G e_k$ with the iteration matrix $G = M^{-1} N$, so the method converges from every starting guess if and only if the spectral radius $\rho(G)$ is less than one. The choice of $M$ trades the cost of each step against the number of steps: the closer $M$ is to $A$, the smaller $\rho(G)$, but the more expensive it is to solve with $M$.

The three classical choices take $M$ from the diagonal $D$, the strictly lower triangle $L$, and the strictly upper triangle $U$ of $A = D + L + U$. The Jacobi method takes $M = D$ and updates every component from the previous iterate, which makes it trivially parallel. The Gauss–Seidel method takes $M = D + L$ and uses each new component as soon as it is available. Successive over-relaxation, or SOR, takes $M = \omega^{-1} D + L$ with a relaxation parameter $\omega$ between zero and two.

| Method | Splitting matrix $M$ | Cost per step | Parallel |
|---|---|---|---|
| Jacobi | $D$ | one product with $A$ | yes |
| Gauss–Seidel | $D + L$ | one triangular solve | no |
| SOR | $\omega^{-1} D + L$ | one triangular solve | no |

: The classical splittings and the cost of one step for a sparse matrix.

## Convergence

For the model problem, the five-point discretization of the Laplace equation on a square grid with $n$ interior points in each direction, the spectral radii are known exactly. The Jacobi iteration matrix has $\rho(G_J) = \cos(\pi h)$ with $h = 1/(n+1)$, which is $1 - \tfrac{1}{2}\pi^2 h^2$ to leading order. Gauss–Seidel squares this radius, and SOR with the optimal parameter reduces it to about $1 - 2\pi h$. Since the number of steps needed to reduce the error by a fixed factor is proportional to $1/(1 - \rho)$, Jacobi and Gauss–Seidel need $O(n^2)$ steps, while optimal SOR needs only $O(n)$.

These estimates explain both the popularity of SOR in the 1950s and its decline. The optimal parameter depends on the spectrum of the matrix, which is rarely known in practice, and the rate deteriorates quickly when $\omega$ is chosen too small. Methods that adapt to the spectrum automatically, without any parameter, are the subject of the next chapter.[^young]

[^young]: The analysis of SOR for consistently ordered matrices is due to Young, whose thesis of 1950 also derived the optimal relaxation parameter.

# Krylov subspace methods

Stationary methods use only the latest iterate. A Krylov subspace method instead looks for the best approximation in the space spanned by all the vectors computed so far. Starting from the residual $r_0 = b - A x_0$, the $k$-th Krylov subspace is

$$
\mathcal{K}_k(A, r_0) = \operatorname{span}\{ r_0, A r_0, A^2 r_0, \dots, A^{k-1} r_0 \},
$$

and the method chooses $x_k$ in $x_0 + \mathcal{K}_k$. Different notions of the best approximation give different methods, but all of them need only products with $A$ and a few vector operations per step.

## The conjugate gradient method

When $A$ is symmetric positive definite, the natural choice minimizes the error in the energy norm $\|e\|_A = (e^\top A e)^{1/2}$. The conjugate gradient method computes this minimizer with a short recurrence: each step needs one product with $A$, two inner products, and three vector updates, and only four vectors have to be stored, however many steps are taken.

The error after $k$ steps is bounded by the best polynomial approximation on the spectrum of $A$. With the condition number $\kappa = \lambda_{\max} / \lambda_{\min}$, a bound with Chebyshev polynomials gives

$$
\frac{\|e_k\|_A}{\|e_0\|_A} \le 2 \left( \frac{\sqrt{\kappa} - 1}{\sqrt{\kappa} + 1} \right)^k.
$$

For the model problem $\kappa$ grows like $n^2$, so the conjugate gradient method needs $O(n)$ steps, like optimal SOR, but without a parameter to choose. In practice it often converges much faster than the bound suggests, because the bound ignores how the eigenvalues are distributed: clusters of eigenvalues are resolved after a few steps, and isolated extreme eigenvalues cost one step each.

## Nonsymmetric systems

For a nonsymmetric matrix no method has both a short recurrence and an optimality property, so practical methods give up one of the two. GMRES minimizes the residual norm over the Krylov subspace and is therefore robust, but it stores a basis of the whole subspace, and the work per step grows with the number of steps. It is usually restarted after a fixed number of steps, which bounds the cost but can stall convergence. BiCGSTAB and related methods keep a short recurrence and a fixed cost per step, at the price of irregular convergence and occasional breakdowns.

The choice between them depends less on the method than on the matrix. A well-conditioned matrix makes every method converge quickly; an ill-conditioned one makes every method slow. Changing the system so that it is better conditioned is the subject of the last chapter.

# Preconditioning

A preconditioner is a matrix $P$ that approximates $A$ and is cheap to apply. Instead of $Ax = b$ one solves the equivalent system $P^{-1} A x = P^{-1} b$, or a symmetric variant of it, whose matrix should have a smaller condition number or more clustered eigenvalues. The two requirements pull in opposite directions: $P = A$ would make the system trivial to solve iteratively, but applying $P^{-1}$ would be as hard as the original problem.

## Incomplete factorizations

An incomplete LU factorization computes triangular factors $L$ and $U$ as Gaussian elimination would, but discards every entry that falls outside a prescribed sparsity pattern. The simplest variant keeps the pattern of $A$ itself, so the factors cost no more memory than the matrix. Variants with more fill-in, or with a drop tolerance instead of a fixed pattern, approximate $A$ more closely at a higher cost per step.

Incomplete factorizations are effective for many problems and need no knowledge of where the matrix came from, but they offer few guarantees. The factorization can break down on a zero pivot even when the exact one exists, and for the model problem the condition number of the preconditioned matrix still grows like $n^2$, only with a smaller constant.

## Multigrid

Multigrid methods exploit the origin of the matrix. Stationary iterations such as Gauss–Seidel are slow because they reduce smooth error components very slowly, but they damp oscillatory components quickly. A smooth error, however, can be represented on a coarser grid, where it is again oscillatory relative to the grid spacing. A multigrid cycle therefore alternates a few smoothing steps on each grid with a correction computed on the next coarser grid, recursively down to a grid small enough to solve directly.

For the model problem one cycle reduces the error by a factor independent of the grid size, and it costs a fixed multiple of the work of one product with $A$. Used as a preconditioner for the conjugate gradient method, multigrid therefore solves the system to a fixed accuracy in work proportional to the number of unknowns, which is the best that any method can achieve.
