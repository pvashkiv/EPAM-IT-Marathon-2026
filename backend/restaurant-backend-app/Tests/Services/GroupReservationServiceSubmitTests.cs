using APIHandler.Constants.Orders;
using APIHandler.Entities;
using APIHandler.Exceptions;
using APIHandler.Repositories.GroupReservations;
using APIHandler.Repositories.GuestSessions;
using APIHandler.Repositories.Orders;
using APIHandler.Repositories.Reservations;
using APIHandler.Repositories.Tables;
using APIHandler.Services.Auth;
using APIHandler.Services.GroupReservations;
using APIHandler.Services.Locations;
using Moq;

namespace APIHandler.Tests.Services;

public class GroupReservationServiceSubmitTests
{
    private const string OwnerId = "user-owner";
    private const string GroupId = "grp-1";
    private const string ReservationId = "res-1";

    private readonly Mock<IGroupReservationRepository> _groupReservationRepository = new();
    private readonly Mock<IReservationRepository> _reservationRepository = new();
    private readonly Mock<IGuestSessionRepository> _guestSessionRepository = new();
    private readonly Mock<IOrderRepository> _orderRepository = new();
    private readonly GroupReservationService _service;

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

    private readonly Order _order = new()
    {
        OrderId = "order-1",
        CustomerId = OwnerId,
        ReservationId = ReservationId,
        ReservationAddress = "Street 1",
        ReservationTime = "now",
        Dishes = [new OrderItem { DishId = "dish-soup", Quantity = 1, State = OrderItemState.Pending }],
        Status = OrderStatus.Created,
    };

    public GroupReservationServiceSubmitTests()
    {
        _service = new GroupReservationService(
            _groupReservationRepository.Object,
            Mock.Of<ITableRepository>(),
            _reservationRepository.Object,
            _guestSessionRepository.Object,
            Mock.Of<IUserService>(),
            Mock.Of<ILocationService>(),
            _orderRepository.Object);

        _groupReservationRepository.Setup(r => r.GetGroupReservationByIdAsync(GroupId)).ReturnsAsync(_group);
        _reservationRepository.Setup(r => r.GetReservationByIdAsync(ReservationId)).ReturnsAsync(_reservation);
        _orderRepository.Setup(r => r.GetOrderByReservationIdAsync(ReservationId)).ReturnsAsync(_order);
    }

    private static GuestSession Guest(string id, bool isSubmitted, params (string DishId, int Quantity)[] dishes) => new()
    {
        Id = id,
        GroupReservationId = GroupId,
        GuestName = id,
        IsSubmitted = isSubmitted,
        Dishes = dishes.Select(d => new OrderItem { DishId = d.DishId, Quantity = d.Quantity }).ToList(),
    };

    private void GivenSessions(params GuestSession[] sessions)
        => _guestSessionRepository.Setup(r => r.GetAllByGroupReservationIdAsync(GroupId)).ReturnsAsync([.. sessions]);

    [Fact]
    public async Task SubmitGroupPreOrderAsync_MergesSubmittedGuestDishesIntoOrderByDishId()
    {
        GivenSessions(
            Guest("gs-anna", true, ("dish-salad", 2), ("dish-soup", 1)),
            Guest("gs-bob", true, ("dish-salad", 1)),
            Guest("gs-carl", false, ("dish-cake", 5)));

        var result = await _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId);

        Assert.Equal(
            [("dish-soup", 2), ("dish-salad", 3)],
            result.Select(d => (d.DishId, d.Quantity)));
        Assert.DoesNotContain(_order.Dishes, d => d.DishId == "dish-cake");
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_UpdatesOrderAndGroupStatusesAndFreezesOwnerCart()
    {
        var ownerSession = GuestSession.CreateOwnerSession(GroupId, OwnerId);
        GivenSessions(ownerSession, Guest("gs-anna", true, ("dish-salad", 2)));

        await _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId);

        _orderRepository.Verify(r => r.SaveOrderAsync(It.Is<Order>(o => o.Status == OrderStatus.SubmittedByCustomer)), Times.Once);
        _groupReservationRepository.Verify(r => r.SaveGroupReservationAsync(It.Is<GroupReservation>(g => g.Status == GroupReservationStatus.Submitted)), Times.Once);
        Assert.True(ownerSession.IsSubmitted);
        Assert.Equal([("dish-soup", 1)], ownerSession.Dishes.Select(d => (d.DishId, d.Quantity)));
        _guestSessionRepository.Verify(r => r.SaveAsync(ownerSession), Times.Once);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_NoSubmittedGuestSessions_ThrowsValidation()
    {
        GivenSessions(GuestSession.CreateOwnerSession(GroupId, OwnerId), Guest("gs-anna", false, ("dish-salad", 1)));

        var exception = await Assert.ThrowsAsync<ValidationException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId));

        Assert.Equal("No submitted guest sessions found to consolidate.", exception.Message);
        _groupReservationRepository.Verify(r => r.SaveGroupReservationAsync(It.IsAny<GroupReservation>()), Times.Never);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_SubmittedSessionsWithoutDishes_ThrowsValidation()
    {
        GivenSessions(Guest("gs-anna", true));

        var exception = await Assert.ThrowsAsync<ValidationException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId));

        Assert.Equal("No dishes selected in the submitted guest sessions.", exception.Message);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task SubmitGroupPreOrderAsync_NoActiveOrder_ThrowsValidation(bool orderExistsButCancelled)
    {
        _order.Status = OrderStatus.Cancelled;
        if (!orderExistsButCancelled)
            _orderRepository.Setup(r => r.GetOrderByReservationIdAsync(ReservationId)).ReturnsAsync((Order?)null);
        GivenSessions(Guest("gs-anna", true, ("dish-salad", 1)));

        var exception = await Assert.ThrowsAsync<ValidationException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId));

        Assert.Equal("Active order not found for this reservation.", exception.Message);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_UnknownGroup_ThrowsGroupReservationNotFound()
    {
        await Assert.ThrowsAsync<GroupReservationNotFoundException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, "missing", ReservationId));
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_UnknownReservation_ThrowsReservationNotFound()
    {
        await Assert.ThrowsAsync<ReservationNotFoundException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, "missing"));
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_ReservationOfAnotherGroup_ThrowsValidation()
    {
        _group.ReservationId = "res-other";

        var exception = await Assert.ThrowsAsync<ValidationException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId));

        Assert.Equal("Group reservation does not belong to this reservation.", exception.Message);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_NotOwner_ThrowsActionForbidden()
    {
        await Assert.ThrowsAsync<ActionForbiddenException>(() => _service.SubmitGroupPreOrderAsync("someone-else", GroupId, ReservationId));
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_AlreadySubmitted_ThrowsGroupReservationSubmitted()
    {
        _group.Status = GroupReservationStatus.Submitted;

        await Assert.ThrowsAsync<GroupReservationSubmittedException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId));
        _orderRepository.Verify(r => r.SaveOrderAsync(It.IsAny<Order>()), Times.Never);
    }

    [Fact]
    public async Task SubmitGroupPreOrderAsync_ClosedGroup_ThrowsGroupReservationExpired()
    {
        _group.Status = GroupReservationStatus.Closed;

        await Assert.ThrowsAsync<GroupReservationExpiredException>(() => _service.SubmitGroupPreOrderAsync(OwnerId, GroupId, ReservationId));
    }
}
