/*==========================================================================================================================================
                                                    ENGINEERINGSTRESSSOLVER.CPP
==========================================================================================================================================*/
// Deterministic native port of the reference 12^3 Navier–Cauchy lattice and wake-shielded crack propagation.

#include "Frontier/Engine/Fracture/FracturePartition.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <limits>
#include <vector>

namespace Frontier::Fracture
{
namespace
{
constexpr double Pi = 3.1415926535897932384626433832795;
using V3 = std::array<double, 3>;
using T6 = std::array<double, 6>;

V3 Add(V3 A, const V3& B) { for (int I = 0; I < 3; ++I) A[I] += B[I]; return A; }
V3 Sub(V3 A, const V3& B) { for (int I = 0; I < 3; ++I) A[I] -= B[I]; return A; }
V3 Mul(V3 A, double S) { for (double& X : A) X *= S; return A; }
double Dot(const V3& A, const V3& B) { return A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; }
V3 Cross(const V3& A, const V3& B)
{
    return {A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]};
}
double Length(const V3& A) { return std::sqrt(Dot(A, A)); }
V3 Normalize(V3 A)
{
    const double L = Length(A);
    if (L > 1.0e-12) for (double& X : A) X /= L;
    else A = {1.0, 0.0, 0.0};
    return A;
}

double Clamp(double X, double A, double B) { return std::max(A, std::min(B, X)); }

class Stream
{
  public:
    explicit Stream(uint32_t Seed) : State((Seed ? Seed : 42u) * 2654435761u) { if (!State) State = 1; }
    double Next()
    {
        ++Draws;
        State += 0x6D2B79F5u;
        uint32_t T = State;
        T = (T ^ (T >> 15)) * (T | 1u);
        T ^= T + ((T ^ (T >> 7)) * (T | 61u));
        return static_cast<double>(T ^ (T >> 14)) / 4294967296.0;
    }
    uint64_t Draws = 0;
  private:
    uint32_t State;
};

struct EngineeringMaterial
{
    double CompressionMPa;
    double FrictionDegrees;
};
EngineeringMaterial ResolveEngineeringMaterial(MaterialKind Kind)
{
    switch (Kind)
    {
    case MaterialKind::Granite: return {165.0, 48.0};
    case MaterialKind::Wood: return {45.0, 24.0};
    case MaterialKind::Glass: return {700.0, 30.0};
    case MaterialKind::Tempered: return {900.0, 32.0};
    case MaterialKind::Plastic: return {68.0, 8.0};
    default: return {38.0, 36.0};
    }
}

bool PointInside(const Polyhedron& Shape, const V3& P)
{
    for (const Face& F : Shape.Faces)
    {
        if (F.Indices.size() < 3) continue;
        const V3& A = Shape.Vertices[F.Indices[0]];
        const V3 E1 = Sub(Shape.Vertices[F.Indices[1]], A);
        const V3 E2 = Sub(Shape.Vertices[F.Indices[2]], A);
        if (Dot(Sub(P, A), Cross(E1, E2)) > 1.0e-5) return false;
    }
    return true;
}

// Matches SolveSymmetricEigen3x3.js: ordered eigenvalues, largest-cross-product eigenvectors, and von Mises stress.
void Eigen(const T6& S, std::array<double, 10>& O)
{
    const double xx=S[0], yy=S[1], zz=S[2], xy=S[3], yz=S[4], xz=S[5];
    const double P1 = xy*xy + xz*xz + yz*yz;
    const double Q = (xx + yy + zz) / 3.0;
    double A, B, C;
    if (P1 < 1.0e-20)
    {
        A=xx; B=yy; C=zz;
        if (A < B) std::swap(A,B); if (B < C) std::swap(B,C); if (A < B) std::swap(A,B);
    }
    else
    {
        const double bx=xx-Q, by=yy-Q, bz=zz-Q;
        const double P=std::sqrt((bx*bx+by*by+bz*bz+2.0*P1)/6.0);
        const double cx=bx/P, cy=by/P, cz=bz/P, cxy=xy/P, cyz=yz/P, cxz=xz/P;
        const double Det = cx*(cy*cz-cyz*cyz)-cxy*(cxy*cz-cyz*cxz)+cxz*(cxy*cyz-cy*cxz);
        const double Phi=std::acos(Clamp(0.5*Det,-1.0,1.0))/3.0;
        A=Q+2.0*P*std::cos(Phi);
        C=Q+2.0*P*std::cos(Phi+2.0*Pi/3.0);
        B=3.0*Q-A-C;
    }
    auto Vector = [&](double L, int Offset, V3 Fallback)
    {
        const V3 R0{xx-L,xy,xz}, R1{xy,yy-L,yz}, R2{xz,yz,zz-L};
        const V3 C01=Cross(R0,R1), C02=Cross(R0,R2), C12=Cross(R1,R2);
        const double D01=Dot(C01,C01), D02=Dot(C02,C02), D12=Dot(C12,C12);
        V3 V=Fallback; double Best=D01;
        if (D01>1.0e-22) V=C01;
        if (D02>Best && D02>1.0e-22) { Best=D02; V=C02; }
        if (D12>Best && D12>1.0e-22) V=C12;
        V=Normalize(V); O[Offset]=V[0]; O[Offset+1]=V[1]; O[Offset+2]=V[2];
    };
    Vector(A,3,{1,0,0}); Vector(C,6,{0,1,0});
    const double D12=A-B, D23=B-C, D31=C-A;
    O[0]=A; O[1]=B; O[2]=C;
    O[9]=std::sqrt(0.5*(D12*D12+D23*D23+D31*D31));
}

struct Lattice
{
    int N=12;
    int Total=1728;
    V3 Min{};
    V3 Span{};
    double Hx=0,Hy=0,Hz=0,HMean=0,VoxelVolume=0;
    double ForceMax=0,ContactRadius=0,PeakPressure=0;
    std::vector<uint8_t> Active,Anchored;
    std::vector<double> Pos,Disp,Force,Stress;
};

Lattice BuildLattice(const Polyhedron& Root, const Metrics& M, const Material& Mat,
                     const EngineeringMaterial& Eng, double Energy, const V3& Impact, const V3& ImpactNormal)
{
    Lattice L;
    L.Min=M.BoundsMin;
    for (int A=0; A<3; ++A) L.Span[A]=std::max(0.05,M.Span[A]);
    L.Hx=L.Span[0]/L.N; L.Hy=L.Span[1]/L.N; L.Hz=L.Span[2]/L.N;
    L.HMean=(L.Hx+L.Hy+L.Hz)/3.0; L.VoxelVolume=L.Hx*L.Hy*L.Hz;
    const double E_MPa=Mat.YoungModulusGPa*1000.0;
    const double Nu=Clamp(Mat.PoissonRatio,0.10,0.45);
    const double EStar=(E_MPa*1.0e6)/(1.0-Nu*Nu);
    const double Indenter=std::max(0.025,M.Radius*0.10);
    L.ForceMax=std::pow(1.25*Energy,0.6)*std::pow(1.3333*EStar*std::sqrt(Indenter),0.4);
    L.ContactRadius=std::max(L.HMean*1.15,std::min(M.Radius*0.42,std::cbrt((0.75*L.ForceMax*Indenter)/EStar)));
    L.PeakPressure=std::min(Eng.CompressionMPa*6.5,(1.5*L.ForceMax)/(Pi*L.ContactRadius*L.ContactRadius*1.0e6));
    const double Lambda=(E_MPa*Nu)/((1.0+Nu)*(1.0-2.0*Nu));
    const double Mu=E_MPa/(2.0*(1.0+Nu));
    L.Active.assign(L.Total,0); L.Anchored.assign(L.Total,0);
    L.Pos.assign(L.Total*3,0.0); L.Disp.assign(L.Total*3,0.0); L.Force.assign(L.Total*3,0.0);
    L.Stress.assign(L.Total*6,0.0);
    const V3 Impulse=Mul(Normalize(ImpactNormal),-1.0);
    for (int Iz=0; Iz<L.N; ++Iz) for (int Iy=0; Iy<L.N; ++Iy) for (int Ix=0; Ix<L.N; ++Ix)
    {
        const int I=(Iz*L.N+Iy)*L.N+Ix;
        const V3 P{L.Min[0]+(Ix+0.5)*L.Hx,L.Min[1]+(Iy+0.5)*L.Hy,L.Min[2]+(Iz+0.5)*L.Hz};
        for (int A=0; A<3; ++A) L.Pos[I*3+A]=P[A];
        if (!PointInside(Root,P)) continue;
        L.Active[I]=1; if (Iy==0) L.Anchored[I]=1;
        const V3 R=Sub(P,Impact);
        const double Depth=Dot(R,Impulse);
        const V3 Perp=Sub(R,Mul(Impulse,Depth));
        const double Radius=Length(Perp);
        if (Depth>=-L.HMean*1.2 && Depth<=L.ContactRadius*2.4 && Radius<=L.ContactRadius*1.6)
        {
            const double Q=std::max(0.0,1.0-(Radius*Radius)/std::pow(L.ContactRadius*1.6,2.0));
            const double Atten=std::exp(-std::max(0.0,Depth)/(L.ContactRadius*1.5));
            const double Pressure=L.PeakPressure*std::sqrt(Q)*Atten;
            const double InvR=Radius>1.0e-6?1.0/Radius:0.0;
            for (int A=0; A<3; ++A)
                L.Force[I*3+A]+=(Impulse[A]*Pressure+Perp[A]*InvR*Pressure*Nu*0.85)/L.HMean;
        }
        if (Depth>M.Radius*0.45 && Radius<L.ContactRadius*2.8)
        {
            const double Pull=L.PeakPressure*0.16*std::exp(-(Radius*Radius)/std::pow(L.ContactRadius*2.5,2.0));
            for (int A=0; A<3; ++A) L.Force[I*3+A]+=Impulse[A]*Pull/L.HMean;
        }
    }
    const double InvH2=1.0/(L.HMean*L.HMean);
    const double Diag=2.0*(Lambda+4.0*Mu)*InvH2;
    constexpr double Omega=1.48;
    for (int Iter=0; Iter<28; ++Iter)
        for (int Iz=0; Iz<L.N; ++Iz) for (int Iy=0; Iy<L.N; ++Iy) for (int Ix=0; Ix<L.N; ++Ix)
        {
            const int I=(Iz*L.N+Iy)*L.N+Ix;
            if (!L.Active[I] || L.Anchored[I]) continue;
            const int Xm=Ix>0&&L.Active[I-1]?I-1:I, Xp=Ix+1<L.N&&L.Active[I+1]?I+1:I;
            const int Ym=Iy>0&&L.Active[I-L.N]?I-L.N:I, Yp=Iy+1<L.N&&L.Active[I+L.N]?I+L.N:I;
            const int Zm=Iz>0&&L.Active[I-L.N*L.N]?I-L.N*L.N:I, Zp=Iz+1<L.N&&L.Active[I+L.N*L.N]?I+L.N*L.N:I;
            for (int A=0; A<3; ++A)
            {
                const double Lap=(L.Disp[Xm*3+A]+L.Disp[Xp*3+A]+L.Disp[Ym*3+A]+L.Disp[Yp*3+A]+L.Disp[Zm*3+A]+L.Disp[Zp*3+A])*InvH2;
                const int AxisNeighborM=A==0?Xm:(A==1?Ym:Zm), AxisNeighborP=A==0?Xp:(A==1?Yp:Zp);
                const double D2=(L.Disp[AxisNeighborM*3+A]+L.Disp[AxisNeighborP*3+A])*InvH2;
                const double Rhs=Mu*Lap+(Lambda+Mu)*D2+L.Force[I*3+A];
                L.Disp[I*3+A]+=Omega*(Rhs/Diag-L.Disp[I*3+A]);
            }
        }
    for (int Iz=0; Iz<L.N; ++Iz) for (int Iy=0; Iy<L.N; ++Iy) for (int Ix=0; Ix<L.N; ++Ix)
    {
        const int I=(Iz*L.N+Iy)*L.N+Ix;
        if (!L.Active[I]) continue;
        const int Xm=Ix>0&&L.Active[I-1]?I-1:I, Xp=Ix+1<L.N&&L.Active[I+1]?I+1:I;
        const int Ym=Iy>0&&L.Active[I-L.N]?I-L.N:I, Yp=Iy+1<L.N&&L.Active[I+L.N]?I+L.N:I;
        const int Zm=Iz>0&&L.Active[I-L.N*L.N]?I-L.N*L.N:I, Zp=Iz+1<L.N&&L.Active[I+L.N*L.N]?I+L.N*L.N:I;
        const double InvDx=1.0/((Xp>Xm?Xp-Xm:1)*L.Hx), InvDy=1.0/((Yp>Ym?Yp-Ym:1)*L.Hy), InvDz=1.0/((Zp>Zm?Zp-Zm:1)*L.Hz);
        const double Exx=(L.Disp[Xp*3]-L.Disp[Xm*3])*InvDx;
        const double Eyy=(L.Disp[Yp*3+1]-L.Disp[Ym*3+1])*InvDy;
        const double Ezz=(L.Disp[Zp*3+2]-L.Disp[Zm*3+2])*InvDz;
        const double Exy=0.5*((L.Disp[Yp*3]-L.Disp[Ym*3])*InvDy+(L.Disp[Xp*3+1]-L.Disp[Xm*3+1])*InvDx);
        const double Eyz=0.5*((L.Disp[Zp*3+1]-L.Disp[Zm*3+1])*InvDz+(L.Disp[Yp*3+2]-L.Disp[Ym*3+2])*InvDy);
        const double Exz=0.5*((L.Disp[Zp*3]-L.Disp[Zm*3])*InvDz+(L.Disp[Xp*3+2]-L.Disp[Xm*3+2])*InvDx);
        const double Trace=Exx+Eyy+Ezz;
        double Sxx=Lambda*Trace+2.0*Mu*Exx, Syy=Lambda*Trace+2.0*Mu*Eyy, Szz=Lambda*Trace+2.0*Mu*Ezz;
        const double Txy=2.0*Mu*Exy, Tyz=2.0*Mu*Eyz, Txz=2.0*Mu*Exz;
        const V3 P{L.Pos[I*3],L.Pos[I*3+1],L.Pos[I*3+2]}, R=Sub(P,Impact);
        const double Rho=std::max(L.ContactRadius*0.65,Length(R));
        const double Bouss=L.PeakPressure*0.24*std::pow(L.ContactRadius/Rho,1.65);
        V3 Hoop=Cross(Impulse,R); const double HoopLength=Length(Hoop);
        Hoop=HoopLength>1.0e-6?Mul(Hoop,1.0/HoopLength):V3{1,0,0};
        Sxx+=Bouss*Hoop[0]*Hoop[0]; Syy+=Bouss*Hoop[1]*Hoop[1]; Szz+=Bouss*Hoop[2]*Hoop[2];
        if (Mat.StoredEnergyJPerM3>0.0)
        {
            const double NormZ=(P[2]-M.Centroid[2])/std::max(0.02,0.5*L.Span[2]);
            const double Residual=48.0*(1.0-3.0*NormZ*NormZ); Sxx+=Residual; Syy+=Residual;
        }
        const int B=I*6; L.Stress[B]=Sxx; L.Stress[B+1]=Syy; L.Stress[B+2]=Szz;
        L.Stress[B+3]=Txy; L.Stress[B+4]=Tyz; L.Stress[B+5]=Txz;
    }
    return L;
}

void RelaxStress(Lattice& L, const V3& N, double D, const Metrics& Shard, double Relief)
{
    const double Pad=Relief*1.15;
    const V3 Min{Shard.BoundsMin[0]-Pad,Shard.BoundsMin[1]-Pad,Shard.BoundsMin[2]-Pad};
    const V3 Max{Shard.BoundsMax[0]+Pad,Shard.BoundsMax[1]+Pad,Shard.BoundsMax[2]+Pad};
    for (int I=0; I<L.Total; ++I)
    {
        if (!L.Active[I]) continue;
        const V3 P{L.Pos[I*3],L.Pos[I*3+1],L.Pos[I*3+2]};
        if (P[0]<Min[0]||P[0]>Max[0]||P[1]<Min[1]||P[1]>Max[1]||P[2]<Min[2]||P[2]>Max[2]) continue;
        const double Dist=std::fabs(Dot(N,P)-D);
        if (Dist>Relief*2.2) continue;
        const double W=0.92*std::exp(-Dist/std::max(1.0e-4,Relief));
        const double P00=1-W*N[0]*N[0], P01=-W*N[0]*N[1], P02=-W*N[0]*N[2];
        const double P11=1-W*N[1]*N[1], P12=-W*N[1]*N[2], P22=1-W*N[2]*N[2];
        const int B=I*6; const double S00=L.Stress[B],S11=L.Stress[B+1],S22=L.Stress[B+2],S01=L.Stress[B+3],S12=L.Stress[B+4],S02=L.Stress[B+5];
        const double M00=P00*S00+P01*S01+P02*S02, M01=P00*S01+P01*S11+P02*S12, M02=P00*S02+P01*S12+P02*S22;
        const double M10=P01*S00+P11*S01+P12*S02, M11=P01*S01+P11*S11+P12*S12, M12=P01*S02+P11*S12+P12*S22;
        const double M20=P02*S00+P12*S01+P22*S02, M21=P02*S01+P12*S11+P22*S12, M22=P02*S02+P12*S12+P22*S22;
        L.Stress[B]=M00*P00+M01*P01+M02*P02; L.Stress[B+1]=M10*P01+M11*P11+M12*P12;
        L.Stress[B+2]=M20*P02+M21*P12+M22*P22; L.Stress[B+3]=M00*P01+M01*P11+M02*P12;
        L.Stress[B+4]=M10*P02+M11*P12+M12*P22; L.Stress[B+5]=M00*P02+M01*P12+M02*P22;
    }
}

struct WorkCell { Polyhedron Shape; Metrics Measure; uint32_t Generation=0; double MinimumSpanGate=0; };
}

std::vector<Polyhedron> SolveEngineeringPartition(const Polyhedron& Base, const Metrics& BaseMetrics,
                                                  const Request& Input, const Material& Mat, uint32_t Ceiling,
                                                  double EnergyBudget, double& OutSpentEnergyJ,
                                                  uint64_t& OutRandomDraws)
{
    Stream Rng(Input.Seed);
    const EngineeringMaterial Eng=ResolveEngineeringMaterial(Mat.Kind);
    const V3 Impact=Input.ImpactPointMetres, ImpactNormal=Normalize(Input.ImpactNormal);
    const double ObjRadius=std::max(0.1,BaseMetrics.Radius);
    const double ImpactEnergy=std::max(15.0,Input.EnergyJoules);
    Lattice L=BuildLattice(Base,BaseMetrics,Mat,Eng,ImpactEnergy,Impact,ImpactNormal);
    const double EPa=Mat.YoungModulusGPa*1.0e9, Nu=Mat.PoissonRatio;
    const double Hillerborg=(EPa*Mat.FractureEnergyJPerM2)/std::pow(Mat.TensileStrengthMPa*1.0e6,2.0);
    const double Phi=Eng.FrictionDegrees*Pi/180.0, SinPhi=std::sin(Phi), CosPhi=std::cos(Phi);
    const double Cohesion=(Eng.CompressionMPa*(1.0-SinPhi))/(2.0*std::max(0.2,CosPhi));
    const double Theta=0.25*Pi-0.5*Phi;
    const double Relief=std::max(L.HMean*1.45,std::min(ObjRadius*0.38,Hillerborg*0.25));
    std::vector<double> Weibull(L.Total,0.0);
    const double VolumeScale=std::pow(std::max(0.1,BaseMetrics.Volume/(L.VoxelVolume*64.0)),1.0/Mat.WeibullModulus);
    for (int I=0; I<L.Total; ++I)
    {
        if (!L.Active[I]) continue;
        const double U=Clamp(Rng.Next(),0.02,0.995);
        Weibull[I]=std::max(Mat.TensileStrengthMPa*0.28,Mat.TensileStrengthMPa*std::pow(-std::log(1.0-U),1.0/Mat.WeibullModulus)*VolumeScale);
    }
    const double MinSpan=std::max(0.018,Input.MinimumPieceSizeMetres);
    const double Grain=Input.GrainAngleDegrees*Pi/180.0;
    std::vector<WorkCell> Cells{{Base,BaseMetrics,0,std::min({BaseMetrics.Span[0],BaseMetrics.Span[1],BaseMetrics.Span[2]})}};
    double Remaining=EnergyBudget; OutSpentEnergyJ=0.0;
    uint32_t Token=100;
    const uint32_t MaxIterations=Ceiling*6;
    uint32_t Iter=0;
    std::array<double,10> Eig{};
    const bool Fibrous=Mat.Mode==FractureMode::Fibrous;
    while (Cells.size()<Ceiling && Remaining>0.0 && Iter++<MaxIterations)
    {
        int BestIndex=-1; double BestScore=-1.0e30; V3 BestNormal{1,0,0}, BestPivot{}; bool BestShear=false;
        for (size_t S=0; S<Cells.size(); ++S)
        {
            const WorkCell& Cell=Cells[S]; const Metrics& M=Cell.Measure;
            if (M.Volume<1.0e-6 || Cell.MinimumSpanGate<MinSpan*0.82) continue;
            const auto GridIndex=[&](int Axis) {
                const double Span=L.Span[Axis];
                const int G=static_cast<int>(std::floor(((M.Centroid[Axis]-L.Min[Axis])/Span)*L.N));
                return std::clamp(G,0,L.N-1);
            };
            const int Gx=GridIndex(0), Gy=GridIndex(1), Gz=GridIndex(2);
            double LocalPeak=-1.0e30; V3 LocalNormal{1,0,0}, LocalPivot=M.Centroid; bool LocalShear=false;
            for (int Dz=-1; Dz<=1; ++Dz) for (int Dy=-1; Dy<=1; ++Dy) for (int Dx=-1; Dx<=1; ++Dx)
            {
                const int X=Gx+Dx,Y=Gy+Dy,Z=Gz+Dz;
                if (X<0||X>=L.N||Y<0||Y>=L.N||Z<0||Z>=L.N) continue;
                const int V=(Z*L.N+Y)*L.N+X; if (!L.Active[V]) continue;
                const V3 P{L.Pos[V*3],L.Pos[V*3+1],L.Pos[V*3+2]};
                if (P[0]<M.BoundsMin[0]||P[0]>M.BoundsMax[0]||P[1]<M.BoundsMin[1]||P[1]>M.BoundsMax[1]||P[2]<M.BoundsMin[2]||P[2]>M.BoundsMax[2]) continue;
                const int B=V*6; const T6 T{L.Stress[B],L.Stress[B+1],L.Stress[B+2],L.Stress[B+3],L.Stress[B+4],L.Stress[B+5]};
                Eigen(T,Eig); const double S1=Eig[0],S3=Eig[2];
                const double Rankine=std::max(0.05,S1)/std::max(0.2,Weibull[V]);
                const double Tau=0.5*(S1-S3), Mean=0.5*(S1+S3);
                const double Mohr=Tau/std::max(0.5,Cohesion*CosPhi-Mean*SinPhi);
                const double Priority=std::max(Rankine,Mohr*0.92)*std::pow(M.Volume/BaseMetrics.Volume,0.28);
                if (Priority>LocalPeak)
                {
                    LocalPeak=Priority; LocalPivot=Add(Mul(M.Centroid,0.65),Mul(P,0.35));
                    if (Mohr*0.92>Rankine && !Fibrous)
                    {
                        const double Sign=((Iter+static_cast<uint32_t>(S))&1u)?1.0:-1.0;
                        const V3 E1{Eig[3],Eig[4],Eig[5]}, E3{Eig[6],Eig[7],Eig[8]};
                        LocalNormal=Add(Mul(E1,std::cos(Theta)),Mul(E3,std::sin(Theta)*Sign)); LocalShear=true;
                    }
                    else { LocalNormal={Eig[3],Eig[4],Eig[5]}; LocalShear=false; }
                }
            }
            if (LocalPeak < -1.0e20)
            {
                const double D=Length(Sub(M.Centroid,Impact)); LocalPeak=(1.2/(0.2+D))*std::pow(M.Volume/BaseMetrics.Volume,0.35);
                LocalNormal={-(M.Centroid[1]-Impact[1]),M.Centroid[0]-Impact[0],(Rng.Next()-0.5)*0.4};
                if (Length(LocalNormal)<1.0e-4) LocalNormal={1,0,0};
            }
            if (LocalPeak>BestScore) { BestScore=LocalPeak; BestIndex=static_cast<int>(S); BestNormal=LocalNormal; BestPivot=LocalPivot; BestShear=LocalShear; }
        }
        if (BestIndex<0) break;
        WorkCell Target=Cells[BestIndex]; const Metrics& M=Target.Measure;
        if (Fibrous)
        {
            const V3 GrainAxis{std::cos(Grain),std::sin(Grain),0.05};
            const double D=Length(Sub(M.Centroid,Impact));
            if (Rng.Next()>0.14*std::max(0.0,1.0-D/ObjRadius))
            {
                const double DG=Dot(BestNormal,GrainAxis);
                BestNormal=Sub(BestNormal,Mul(GrainAxis,DG*0.94));
            }
        }
        else if (Mat.BeddingWeakness>0.0 && Rng.Next()<0.38+Mat.BeddingWeakness*0.35)
        {
            BestNormal={BestNormal[0]*0.25-std::sin(Grain)*0.75,BestNormal[1]*0.25+std::cos(Grain)*0.75,BestNormal[2]*0.25};
        }
        for (int A=0;A<3;++A) BestNormal[A]+=(Rng.Next()-0.5)*Mat.CrackJitter*0.45;
        BestNormal=Normalize(BestNormal);
        V3 P{};
        for (int A=0;A<3;++A) P[A]=0.78*M.Centroid[A]+0.22*BestPivot[A]+(Rng.Next()-0.5)*0.14*M.Radius;
        const double D=Dot(BestNormal,P);
        Polyhedron Front,Back; double CutArea=0.0;
        const uint32_t NewToken=++Token;
        if (!Clip(Target.Shape,BestNormal,D,NewToken,Front,Back,CutArea)) { Cells[BestIndex].MinimumSpanGate*=0.65; continue; }
        const Metrics FrontMetrics=EvaluateMetrics(Front), BackMetrics=EvaluateMetrics(Back);
        if (FrontMetrics.Span[0]<0.0 || BackMetrics.Span[0]<0.0 ||
            std::min({FrontMetrics.Span[0],FrontMetrics.Span[1],FrontMetrics.Span[2]})<MinSpan*0.38 ||
            std::min({BackMetrics.Span[0],BackMetrics.Span[1],BackMetrics.Span[2]})<MinSpan*0.38)
        { Cells[BestIndex].MinimumSpanGate*=0.72; continue; }
        double LocalGc=Mat.FractureEnergyJPerM2;
        if (Fibrous)
        {
            const double Across=std::fabs(BestNormal[0]*std::cos(Grain)+BestNormal[1]*std::sin(Grain));
            LocalGc*=1.0+(Mat.AnisotropyRatio-1.0)*Across*Across;
        }
        else if (Mat.BeddingWeakness>0.0)
        {
            const double Align=std::fabs(-BestNormal[0]*std::sin(Grain)+BestNormal[1]*std::cos(Grain));
            LocalGc*=1.0-Mat.BeddingWeakness*std::pow(Align,4.0);
        }
        if (BestShear) LocalGc*=1.75;
        const double Cost=2.0*LocalGc*CutArea;
        if (Cost>Remaining && Cells.size()>=4) break;
        Remaining=std::max(0.0,Remaining-Cost); OutSpentEnergyJ+=Cost;
        const uint32_t Generation=Target.Generation+1;
        Cells[BestIndex]={std::move(Front),FrontMetrics,Generation,std::min({FrontMetrics.Span[0],FrontMetrics.Span[1],FrontMetrics.Span[2]})};
        Cells.push_back({std::move(Back),BackMetrics,Generation,std::min({BackMetrics.Span[0],BackMetrics.Span[1],BackMetrics.Span[2]})});
        RelaxStress(L,BestNormal,D,M,Relief);
    }
    std::sort(Cells.begin(),Cells.end(),[](const WorkCell& A,const WorkCell& B){return A.Measure.Volume>B.Measure.Volume;});
    std::vector<Polyhedron> Out; Out.reserve(Cells.size());
    for (WorkCell& Cell:Cells) Out.push_back(std::move(Cell.Shape));
    OutRandomDraws=Rng.Draws;
    return Out;
}

} // namespace Frontier::Fracture
