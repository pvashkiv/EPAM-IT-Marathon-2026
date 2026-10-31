using Amazon.CognitoIdentityProvider.Model;
using APIHandler.Constants.Orders;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Models.GuestSessions;
using APIHandler.Repositories.Auth;
using APIHandler.Repositories.Dishes;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Services.GuestSessions;
using Moq;

namespace APIHandler.Tests.Services;

public class GuestSessionServiceGroupSnapshotTests
{
    private const string OwnerId = "user-owner";
    private const string GroupId = "grp-1";
    private const string ReservationId = "res-1";

    private readonly Mock<IGuestSessionRepository> _guestSessionRepository = new();
    private readonly Mock<IGroupReservationRepository> _groupReservationRepository = new();
    private readonly Mock<IDishRepository> _dishRepository = new();
    private readonly Mock<IReservationRepository> _reservationRepository = new();
    private readonly Mock<IUserRepository> _userRepository = new();
    private readonly Mock<IOrderRepository> _orderRepository = new();
    private readonly GuestSessionService _service;

    private readonly GroupReservation _group = new()
    {
        GroupReservationId = GroupId,
        ReservationId = ReservationId,
        ReservationToken = "token",
        Status = GroupReservationStatus.Open,
    };

    private readonly Reservation _reservation = new()
    {
        Id = ReservationId,
        TableId = "table-1",
        WaiterId = "waiter-1",
        CustomerId = OwnerId,
        GuestCount = 5,
    };

    private static readonly Dish Salad = new() { Id = "dish-salad", Name = "Salad", Price = 12 };
    private static readonly Dish Soup = new() { Id = "dish-soup", Name = "Soup", Price = 10 };

    public GuestSessionServiceGroupSnapshotTests()
    {
        _service = new GuestSessionService(
            _groupReservationRepository.Object,
            _guestSessionRepository.Object,
            _dishRepository.Object,
            _reservationRepository.Object,
            _userRepository.Object,
            Mock.Of<ITableRepository>(),
            _orderRepository.Object);

        _groupReservationRepository.Setup(r => r.GetGroupReservationByIdAsync(GroupId)).ReturnsAsync(_group);
        _groupReservationRepository.Setup(r => r.GetByReservationIdAsync(ReservationId)).ReturnsAsync(_group);
        _reservationRepository.Setup(r => r.GetReservationByIdAsync(ReservationId)).ReturnsAsync(_reservation);
        _dishRepository
            .Setup(r => r.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync((IEnumerable<string> ids) => new[] { Salad, Soup }.Where(d => ids.Contains(d.Id)));
    }

    private static OrderItem Item(Dish dish, int quantity, OrderItemState state = OrderItemState.Pending)
        => new() { DishId = dish.Id, Quantity = quantity, State = state };

    private static GuestSession Guest(string id, string name, bool isSubmitted, params OrderItem[] dishes)
        => new() { Id = id, GroupReservationId = GroupId, GuestName = name, IsSubmitted = isSubmitted, Dishes = [.. dishes] };

    private void GivenSessions(params GuestSession[] sessions)
        => _guestSessionRepository
            .Setup(r => r.GetAllByGroupReservationIdAsync(GroupId))
            .ReturnsAsync(() => [.. sessions]);

    private void GivenOwnerOrder(OrderStatus status, params OrderItem[] dishes)
        => _orderRepository
            .Setup(r => r.GetOrderByReservationIdAsync(ReservationId))
            .ReturnsAsync(new Order
            {
                OrderId = "order-1",
                CustomerId = OwnerId,
                ReservationId = ReservationId,
                ReservationAddress = "Street 1",
                ReservationTime = "now",
                Dishes = [.. dishes],
                Status = status,
            });

    [Fact]
    public async Task GetGroupSessionsAsync_OpenGroup_ReturnsOwnerFromOrderFirstThenGuestsWithTotals()
    {
        var ownerSession = GuestSession.CreateOwnerSession(GroupId, OwnerId);
        GivenSessions(ownerSession, Guest("gs-anna", "Anna", true, Item(Salad, 2)), Guest("gs-bob", "Bob", false, Item(Soup, 1)));
        GivenOwnerOrder(OrderStatus.Created, Item(Soup, 3), Item(Salad, 1, OrderItemState.Canceled));
        var user = new UserType { Attributes = [new AttributeType { Name = "given_name", Value = "Olena" }] };
        _userRepository.Setup(r => r.GetUserByIdAsync(OwnerId)).ReturnsAsync(user);

        GetAllSessionsResponse result = await _service.GetGroupSessionsAsync(OwnerId, GroupId);

        var participants = result.Participants.ToList();
        Assert.Equal([ownerSession.Id, "gs-anna", "gs-bob"], participants.Select(p => p.Id));
        Assert.Equal(ParticipantType.Owner, participants[0].Type);
        Assert.Equal("Olena", participants[0].Name);
        Assert.True(participants[0].IsSubmitted);
        Assert.Equal(30, participants[0].Total); // cancelled salad excluded
        Assert.Equal(ParticipantType.Guest, participants[1].Type);
        Assert.Equal(24, participants[1].Total);
        Assert.False(participants[2].IsSubmitted);
        Assert.Equal(30 + 24 + 10, result.Total);
    }

    [Fact]
    public async Task GetGroupSessionsAsync_NoOwnerSessionYet_CreatesItWithDeterministicId()
    {
        GivenSessions(Guest("gs-anna", "Anna", false));

        GetAllSessionsResponse result = await _service.GetGroupSessionsAsync(OwnerId, GroupId);

        Participant owner = result.Participants.First();
        Assert.Equal(GuestSession.OwnerSessionIdFor(GroupId), owner.Id);
        Assert.Equal("Owner", owner.Name);
        Assert.False(owner.IsSubmitted);
        _guestSessionRepository.Verify(r => r.SaveAsync(It.Is<GuestSession>(s => s.IsOwnerSession && s.Id == owner.Id)), Times.Once);
    }

    [Fact]
    public async Task GetGroupSessionsAsync_DishNoLongerExists_SkipsItInsteadOfFailing()
    {
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId), Guest("gs-anna", "Anna", true, Item(Salad, 1), new OrderItem { DishId = "deleted", Quantity = 4 }));

        GetAllSessionsResponse result = await _service.GetGroupSessionsAsync(OwnerId, GroupId);

        Participant anna = result.Participants.Single(p => p.Id == "gs-anna");
        Assert.Single(anna.Items);
        Assert.Equal(12, anna.Total);
    }

    [Fact]
    public async Task GetGroupSessionsAsync_SubmittedGroup_ShowsOwnerCartFrozenInSession()
    {
        _group.Status = GroupReservationStatus.Submitted;
        var ownerSession = GuestSession.CreateOwnerSession(GroupId, OwnerId);
        ownerSession.Dishes = [Item(Soup, 1)];
        ownerSession.IsSubmitted = true;
        GivenSessions(ownerSession, Guest("gs-anna", "Anna", true, Item(Salad, 2)));
        // After submit the order also contains the guests' dishes — they must not be shown twice.
        GivenOwnerOrder(OrderStatus.SubmittedByCustomer, Item(Soup, 1), Item(Salad, 2));

        GetAllSessionsResponse result = await _service.GetGroupSessionsAsync(OwnerId, GroupId);

        Assert.Equal(10, result.Participants.First().Total);
        Assert.Equal(10 + 24, result.Total);
    }

    [Fact]
    public async Task GetGroupSessionsAsync_NotOwner_ThrowsActionForbidden()
    {
        await Assert.ThrowsAsync<ActionForbiddenException>(() => _service.GetGroupSessionsAsync("someone-else", GroupId));
    }

    [Fact]
    public async Task GetGroupSessionsAsync_UnknownGroup_ThrowsGroupReservationNotFound()
    {
        await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => _service.GetGroupSessionsAsync(OwnerId, "missing"));
    }

    [Fact]
    public async Task GetOwnerSessionIdAsync_ExistingOwnerSession_ReturnsItsId()
    {
        var ownerSession = GuestSession.CreateOwnerSession(GroupId, OwnerId);
        GivenSessions(ownerSession, Guest("gs-anna", "Anna", false));

        var result = await _service.GetOwnerSessionIdAsync(OwnerId, ReservationId);

        Assert.Equal(ownerSession.Id, result.GuestSessionId);
        _guestSessionRepository.Verify(r => r.SaveAsync(It.IsAny<GuestSession>()), Times.Never);
    }

    [Fact]
    public async Task GetOwnerSessionIdAsync_NoOwnerSession_CreatesAndReturnsIt()
    {
        GivenSessions();

        var result = await _service.GetOwnerSessionIdAsync(OwnerId, ReservationId);

        Assert.Equal(GuestSession.OwnerSessionIdFor(GroupId), result.GuestSessionId);
        _guestSessionRepository.Verify(r => r.SaveAsync(It.Is<GuestSession>(s => s.IsOwnerSession && s.OwnerUserId == OwnerId)), Times.Once);
    }

    [Fact]
    public async Task GetOwnerSessionIdAsync_NotOwner_ThrowsActionForbidden()
    {
        await Assert.ThrowsAsync<ActionForbiddenException>(() => _service.GetOwnerSessionIdAsync("someone-else", ReservationId));
    }

    [Fact]
    public async Task GetOwnerSessionIdAsync_UnknownReservation_ThrowsReservationNotFound()
    {
        await Assert.ThrowsAsync<ReservationNotFoundException>(() => _service.GetOwnerSessionIdAsync(OwnerId, "missing"));
    }

    [Fact]
    public async Task GetOwnerSessionIdAsync_NoGroupReservation_ThrowsGroupReservationNotFound()
    {
        _groupReservationRepository.Setup(r => r.GetByReservationIdAsync(ReservationId)).ReturnsAsync((GroupReservation?)null);

        await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => _service.GetOwnerSessionIdAsync(OwnerId, ReservationId));
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_Guest_DeletesAndReturnsSnapshotWithoutIt()
    {
        var anna = Guest("gs-anna", "Anna", true, Item(Salad, 2));
        var bob = Guest("gs-bob", "Bob", false, Item(Soup, 1));
        _guestSessionRepository.Setup(r => r.GetByGuestSessionId(anna.Id)).ReturnsAsync(anna);
        // Simulates the eventually consistent index still returning the deleted session.
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId), anna, bob);

        GetAllSessionsResponse result = await _service.DeleteGuestSessionAsync(OwnerId, GroupId, anna.Id);

        _guestSessionRepository.Verify(r => r.DeleteAsync(anna), Times.Once);
        Assert.DoesNotContain(result.Participants, p => p.Id == anna.Id);
        Assert.Equal(10, result.Total);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_OwnerSession_ThrowsValidationAndDeletesNothing()
    {
        var ownerSession = GuestSession.CreateOwnerSession(GroupId, OwnerId);
        _guestSessionRepository.Setup(r => r.GetByGuestSessionId(ownerSession.Id)).ReturnsAsync(ownerSession);

        var exception = await Assert.ThrowsAsync<ValidationException>(() => _service.DeleteGuestSessionAsync(OwnerId, GroupId, ownerSession.Id));

        Assert.Equal("Owner session cannot be removed.", exception.Message);
        _guestSessionRepository.Verify(r => r.DeleteAsync(It.IsAny<GuestSession>()), Times.Never);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_SessionFromAnotherGroup_ThrowsValidation()
    {
        var stranger = Guest("gs-x", "X", false);
        stranger.GroupReservationId = "other-group";
        _guestSessionRepository.Setup(r => r.GetByGuestSessionId(stranger.Id)).ReturnsAsync(stranger);

        var exception = await Assert.ThrowsAsync<ValidationException>(() => _service.DeleteGuestSessionAsync(OwnerId, GroupId, stranger.Id));

        Assert.IsNotType<GuestSessionNotFoundException>(exception);
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_UnknownSession_ThrowsGuestSessionNotFound()
    {
        await Assert.ThrowsAsync<GuestSessionNotFoundException>(() => _service.DeleteGuestSessionAsync(OwnerId, GroupId, "missing"));
    }

    [Fact]
    public async Task DeleteGuestSessionAsync_SubmittedGroup_ThrowsGroupReservationSubmitted()
    {
        _group.Status = GroupReservationStatus.Submitted;

        await Assert.ThrowsAsync<GroupReservationSubmittedException>(() => _service.DeleteGuestSessionAsync(OwnerId, GroupId, "gs-anna"));
    }

    private static readonly Dish Cake = new() { Id = "dish-cake", Name = "Cake", Price = 7 };
    private static readonly Dish Tea = new() { Id = "dish-tea", Name = "Tea", Price = 3 };

    [Fact]
    public async Task GetGroupBoardAsync_ReturnsWhoIsInAndTheirStatusMarkingTheCaller()
    {
        var anna = Guest("gs-anna", "Anna", true, Item(Salad, 2), Item(Soup, 1));
        var bob = Guest("gs-bob", "Bob", false);
        _guestSessionRepository.Setup(r => r.GetByGuestSessionId(bob.Id)).ReturnsAsync(bob);
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId), anna, bob);
        GivenOwnerOrder(OrderStatus.Created, Item(Salad, 1));

        GroupBoardResponse board = await _service.GetGroupBoardAsync(bob.Id);

        Assert.Equal(GroupReservationStatus.Open, board.Status);
        Assert.Equal(5, board.MaxGuests);
        Assert.Equal(
            [("Owner", true, false, true, 1), ("Anna", false, false, true, 3), ("Bob", false, true, false, 0)],
            board.Participants.Select(p => (p.Name, p.IsOwner, p.IsMe, p.IsSubmitted, p.DishCount)));
    }

    [Fact]
    public async Task GetGroupBoardAsync_FavouritesAreTheThreeMostOrderedDishesAcrossTheGroup()
    {
        var anna = Guest("gs-anna", "Anna", true, Item(Salad, 2), Item(Soup, 1), Item(Tea, 1));
        var bob = Guest("gs-bob", "Bob", false, Item(Salad, 1), Item(Cake, 2), Item(Soup, 1));
        _guestSessionRepository.Setup(r => r.GetByGuestSessionId(anna.Id)).ReturnsAsync(anna);
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId), anna, bob);
        _dishRepository
            .Setup(r => r.GetDishesByIdsAsync(It.IsAny<IEnumerable<string>>()))
            .ReturnsAsync((IEnumerable<string> ids) => new[] { Salad, Soup, Cake, Tea }.Where(d => ids.Contains(d.Id)));

        GroupBoardResponse board = await _service.GetGroupBoardAsync(anna.Id);

        // Salad 3; Cake and Soup tie at 2 and are ordered by name; Tea (1) is cut off.
        Assert.Equal([("Salad", 3), ("Cake", 2), ("Soup", 2)], board.Favourites.Select(f => (f.Name, f.Count)));
    }

    [Fact]
    public async Task GetGroupBoardAsync_SessionNotYetInGroupIndex_IsStillListedAsMe()
    {
        var newcomer = Guest("gs-new", "Nina", false);
        _guestSessionRepository.Setup(r => r.GetByGuestSessionId(newcomer.Id)).ReturnsAsync(newcomer);
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId));

        GroupBoardResponse board = await _service.GetGroupBoardAsync(newcomer.Id);

        Assert.Contains(board.Participants, p => p.IsMe && p.Name == "Nina");
    }

    [Fact]
    public async Task GetGroupBoardAsync_UnknownSession_ThrowsGuestSessionNotFound()
    {
        await Assert.ThrowsAsync<GuestSessionNotFoundException>(() => _service.GetGroupBoardAsync("missing"));
    }

    [Fact]
    public async Task GetGroupReservationStatusAsync_OwnerSessionRow_IsNotCountedTwice()
    {
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId), Guest("gs-anna", "Anna", false));

        var status = await _service.GetGroupReservationStatusAsync(GroupId);

        Assert.Equal(2, status.CurrentParticipants);
    }
}
